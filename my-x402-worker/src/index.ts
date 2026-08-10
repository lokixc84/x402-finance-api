import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { generateJwt } from '@coinbase/cdp-sdk/auth'

type Bindings = {
  COINBASE_API_KEY_NAME: string
  COINBASE_PRIVATE_KEY: string
}

const app = new Hono<{ Bindings: Bindings }>()

// ======================================================
// Constants
// ======================================================
const FACILITATOR_HOST = 'api.cdp.coinbase.com'
const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const PAY_TO = '0xE8bC82d53E45e61e07D84536970d695265A51CE4'
const NETWORK = 'eip155:8453'
const WORKER_ORIGIN = 'https://x402-paid-api.x402-finance.workers.dev'

const PRICE_MARKET = '2000'    // $0.002 USDC
const PRICE_SAFETY = '40000'   // $0.04 USDC
const PRICE_CLUSTERS = '10000' // $0.01 USDC

const CACHE_KEY = new Request('https://x402-finance.internal/market-prices')
const CACHE_TTL_SECONDS = 300

let priceCache: { data: any; timestamp: number } | null = null
const MEMORY_TTL_MS = 120_000   // 2 minutes

// Token-safety in-memory cache (per isolate)
const safetyMemory = new Map<string, { data: any; timestamp: number }>()
const SAFETY_MEMORY_TTL_MS = 60_000 // 60 seconds
const SAFETY_CACHE_TTL_SECONDS = 60

// ======================================================
// CORS
// ======================================================
app.use('*', async (c, next) => {
  c.header('Access-Control-Allow-Origin', '*')
  c.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  c.header(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, PAYMENT-SIGNATURE, PAYMENT-REQUIRED'
  )
  c.header('Access-Control-Expose-Headers', 'PAYMENT-REQUIRED, PAYMENT-RESPONSE')

  if (c.req.method === 'OPTIONS') {
    return c.text('', 204)
  }
  await next()
})

// ======================================================
// JWT + Challenge + Facilitator helpers
// ======================================================
async function getAuthHeader(env: Bindings, requestPath: string): Promise<string> {
  const token = await generateJwt({
    apiKeyId: env.COINBASE_API_KEY_NAME,
    apiKeySecret: env.COINBASE_PRIVATE_KEY,
    requestMethod: 'POST',
    requestHost: FACILITATOR_HOST,
    requestPath,
    expiresIn: 120
  })
  return `Bearer ${token}`
}

function createChallenge(resource: string, amount: string, description: string, includeBazaar = false) {
  const challenge: any = {
    x402Version: 2,
    accepts: [
      {
        scheme: 'exact',
        network: NETWORK,
        maxAmountRequired: amount,
        amount,
        asset: USDC_BASE,
        payTo: PAY_TO,
        resource,
        description,
        maxTimeoutSeconds: 60,
        extra: { name: 'USD Coin', version: '2' }
      }
    ]
  }

  if (includeBazaar) {
    challenge.extensions = {
      bazaar: {
        info: {
          input: {
            type: 'http',
            method: 'GET',
            queryParams: {}
          },
          output: {
            type: 'json',
            example: {
              success: true,
              data: {
                risk_score: 18,
                risk_level: 'Low',
                recommendation: 'proceed_with_caution'
              }
            }
          }
        }
      }
    }
  }

  return challenge
}

async function callFacilitator(
  env: Bindings,
  path: '/platform/v2/x402/verify' | '/platform/v2/x402/settle',
  body: any,
  retries = path.endsWith('/settle') ? 3 : 1
) {
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const authHeader = await getAuthHeader(env, path)
      const res = await fetch(`https://${FACILITATOR_HOST}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader
        },
        body: JSON.stringify(body)
      })

      const raw = await res.text()
      let data: any
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        console.error(`Facilitator ${path} non-JSON (attempt ${attempt}):`, res.status, raw.slice(0, 200))
        throw new Error(`Facilitator ${path} returned non-JSON status ${res.status}`)
      }

      if (!res.ok) {
        console.error(`Facilitator ${path} failed (attempt ${attempt}):`, res.status, JSON.stringify(data))
        throw new Error(
          `Facilitator ${path} error: ${res.status} ${data?.errorMessage || data?.error || ''}`.trim()
        )
      }

      return data
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err))
      if (attempt < retries) {
        console.warn(`Facilitator ${path} retry ${attempt}/${retries}:`, lastError.message)
        await new Promise((r) => setTimeout(r, 400 * attempt))
        continue
      }
    }
  }

  throw lastError || new Error(`Facilitator ${path} failed`)
}

// ======================================================
// x402 Payment Middleware
// ======================================================
function requireX402Payment(amount: string, description: string, includeBazaar = false) {
  return async (c: any, next: () => Promise<void>) => {
    const paymentSignatureHeader = c.req.header('PAYMENT-SIGNATURE')

    // Stable resource: origin + pathname only (ignore query / scheme noise)
    const url = new URL(c.req.url)
    const stableResource = `${WORKER_ORIGIN}${url.pathname}`

    if (!paymentSignatureHeader) {
      const challenge = createChallenge(stableResource, amount, description, includeBazaar)
      c.header('PAYMENT-REQUIRED', btoa(JSON.stringify(challenge)))
      return c.json(challenge, 402)
    }

    let parsedPayload: any
    try {
      parsedPayload = JSON.parse(atob(paymentSignatureHeader))
    } catch {
      try {
        parsedPayload = JSON.parse(paymentSignatureHeader)
      } catch {
        throw new HTTPException(400, { message: 'Invalid PAYMENT-SIGNATURE header format' })
      }
    }

    try {
      const requirements = createChallenge(stableResource, amount, description, includeBazaar).accepts[0]

      const verifyResult = await callFacilitator(c.env, '/platform/v2/x402/verify', {
        x402Version: 2,
        paymentPayload: parsedPayload,
        paymentRequirements: requirements
      })

      console.log('Verify result:', JSON.stringify(verifyResult, null, 2))

      if (!verifyResult.isValid) {
        const reason = verifyResult.invalidReason || verifyResult.error || 'Unknown verification failure'
        throw new HTTPException(402, { message: `Payment verification failed: ${reason}` })
      }

      let settleResult: any
      try {
        settleResult = await callFacilitator(c.env, '/platform/v2/x402/settle', {
          x402Version: 2,
          paymentPayload: parsedPayload,
          paymentRequirements: requirements
        })
        console.log('Settle result:', JSON.stringify(settleResult, null, 2))
      } catch (settleErr: any) {
        console.error('Settle failed:', settleErr?.message || settleErr)
        throw new HTTPException(402, {
          message: `Payment settlement failed: ${settleErr?.message || 'unknown'}`
        })
      }

      if (settleResult.paymentResponse || settleResult.transaction) {
        c.header(
          'PAYMENT-RESPONSE',
          typeof settleResult.paymentResponse === 'string'
            ? settleResult.paymentResponse
            : btoa(JSON.stringify(settleResult))
        )
      }
      console.log(
        '[PAYMENT SUCCESS] amount=' +
          amount +
          ' payer=' +
          (verifyResult.payer || 'unknown') +
          ' tx=' +
          (settleResult.transaction || 'n/a')
      )

      await next()
    } catch (err: any) {
      if (err instanceof HTTPException) throw err
      console.error('Payment middleware error:', err?.message || err)
      throw new HTTPException(402, {
        message: `Payment processing failed: ${err?.message || 'unknown'}`
      })
    }
  }
}

// ======================================================
// Token Safety helpers
// ======================================================
function flag01(v: any): boolean | null {
  if (v === undefined || v === null || v === '') return null
  return v === '1' || v === 1 || v === true || v === 'true'
}

function parseTax(v: any): number | null {
  if (v === undefined || v === null || v === '') return null
  const n = parseFloat(String(v))
  return Number.isFinite(n) ? n : null
}

async function fetchGoPlus(normalized: string, headers: Record<string, string>, attempts = 3) {
  let lastErr: any = null
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(
        `https://api.gopluslabs.io/api/v1/token_security/8453?contract_addresses=${normalized}`,
        { headers, signal: AbortSignal.timeout(9000) }
      )
      if (res.ok) {
        const json = await res.json()
        const data = json?.result?.[normalized] || null
        if (data) return data
        // Empty result — token unknown to GoPlus; don't retry forever
        console.warn('GoPlus empty result for', normalized)
        return null
      }
      console.warn('GoPlus status:', res.status, 'attempt', i)
      lastErr = new Error(`GoPlus ${res.status}`)
    } catch (e) {
      lastErr = e
      console.warn('GoPlus attempt', i, 'failed', e)
    }
    if (i < attempts) await new Promise((r) => setTimeout(r, 350 * i))
  }
  if (lastErr) console.warn('GoPlus gave up', lastErr)
  return null
}

async function fetchHoneypotIs(normalized: string, headers: Record<string, string>) {
  try {
    // Base = chainID 8453; API key not required at time of writing
    const res = await fetch(
      `https://api.honeypot.is/v2/IsHoneypot?address=${normalized}&chainID=8453`,
      { headers, signal: AbortSignal.timeout(9000) }
    )
    if (!res.ok) {
      console.warn('Honeypot.is status:', res.status)
      return null
    }
    return await res.json()
  } catch (e) {
    console.warn('Honeypot.is failed', e)
    return null
  }
}

async function fetchDexScreener(normalized: string, headers: Record<string, string>) {
  try {
    const res = await fetch(`https://api.dexscreener.com/tokens/v1/base/${normalized}`, {
      headers,
      signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) {
      console.warn('DexScreener status:', res.status)
      return null
    }
    const pairs = await res.json()
    if (Array.isArray(pairs) && pairs.length > 0) {
      return pairs.sort(
        (a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      )[0]
    }
    return null
  } catch (e) {
    console.warn('DexScreener failed', e)
    return null
  }
}

function safetyCacheKey(address: string) {
  return new Request(`https://x402-finance.internal/token-safety/${address.toLowerCase()}`)
}

// ======================================================
// Token Safety (GoPlus + Honeypot.is + DexScreener)
// ======================================================
async function analyzeTokenSafety(address: string) {
  const normalized = address.toLowerCase()
  const now = Date.now()
  const headers = {
    'User-Agent': 'x402-Finance-Worker/2.3',
    Accept: 'application/json'
  }

  // 1) Memory cache
  const mem = safetyMemory.get(normalized)
  if (mem && now - mem.timestamp < SAFETY_MEMORY_TTL_MS) {
    return { ...mem.data, cached: true, stale: false }
  }

  // 2) Cloudflare Cache API
  try {
    const hit = await caches.default.match(safetyCacheKey(normalized))
    if (hit) {
      const data = await hit.json()
      safetyMemory.set(normalized, { data, timestamp: now })
      return { ...data, cached: true, stale: false }
    }
  } catch (e) {
    console.warn('Safety CF cache read failed', e)
  }

  // 3) Parallel upstream fetches
  const [goplus, honeypot, dex] = await Promise.all([
    fetchGoPlus(normalized, headers, 3),
    fetchHoneypotIs(normalized, headers),
    fetchDexScreener(normalized, headers)
  ])

  if (!goplus && !honeypot && !dex) {
    throw new Error('Token safety providers unavailable')
  }

  // --- Merge security signals (prefer GoPlus, fill from Honeypot.is) ---
  let isHoneypot: boolean | null = flag01(goplus?.is_honeypot)
  let canSell: boolean | null =
    goplus != null ? goplus.cannot_sell_all !== '1' && goplus.cannot_sell_all !== 1 : null
  let buyTax: number | null = parseTax(goplus?.buy_tax)
  let sellTax: number | null = parseTax(goplus?.sell_tax)
  let isProxy: boolean | null = flag01(goplus?.is_proxy)
  let isOpenSource: boolean | null = flag01(goplus?.is_open_source)
  let isMintable: boolean | null = flag01(goplus?.is_mintable)
  let ownerRenounced: boolean | null = null
  if (goplus) {
    ownerRenounced =
      !goplus.owner_address ||
      goplus.owner_address === '0x0000000000000000000000000000000000000000' ||
      goplus.can_take_back_ownership === '0'
  }

  // Honeypot.is fill-ins
  if (honeypot) {
    const hp = honeypot.honeypotResult?.isHoneypot
    if (typeof hp === 'boolean') {
      if (isHoneypot === null) isHoneypot = hp
      else if (hp === true) isHoneypot = true // escalate if either source says honeypot
    }
    const sim = honeypot.simulationResult
    if (sim) {
      if (buyTax === null && sim.buyTax !== undefined) buyTax = Number(sim.buyTax) || 0
      if (sellTax === null && sim.sellTax !== undefined) sellTax = Number(sim.sellTax) || 0
      if (canSell === null && typeof sim.sellTax === 'number') {
        // If simulation produced sell tax, sell path exists
        canSell = true
      }
    }
    if (honeypot.honeypotResult?.isHoneypot === true) canSell = false
  }

  const highTax =
    (buyTax !== null && buyTax > 10) || (sellTax !== null && sellTax > 10) ? true : buyTax === null && sellTax === null ? null : false

  const liquidityUsd = dex?.liquidity?.usd ?? null
  const liquidityLocked = goplus?.lp_holder_count ? Number(goplus.lp_holder_count) > 0 : null

  // Risk score — only add points for known-bad signals; unknown does not equal safe
  let risk = 15 // baseline when data is partial
  if (goplus || honeypot) risk = 10
  if (isHoneypot === true) risk += 50
  if (canSell === false) risk += 25
  if (highTax === true) risk += 15
  if (isMintable === true) risk += 10
  if (isProxy === true) risk += 5
  if (isOpenSource === false) risk += 8
  if (liquidityUsd !== null && liquidityUsd < 5000) risk += 12
  if (liquidityUsd !== null && liquidityUsd < 1000) risk += 10
  if (!goplus && !honeypot) risk += 15 // no security source at all
  risk = Math.min(100, risk)

  const risk_level =
    risk >= 70 ? 'High' : risk >= 40 ? 'Medium' : risk >= 20 ? 'Low-Medium' : 'Low'

  const hasSecurity = !!(goplus || honeypot)
  const hasMarket = !!dex
  const data_quality =
    hasSecurity && hasMarket ? 'full' : hasSecurity ? 'security_only' : hasMarket ? 'liquidity_only' : 'minimal'

  // Agent-facing recommendation (explicit, not marketing)
  let recommendation: 'avoid' | 'high_caution' | 'proceed_with_caution' | 'insufficient_data'
  if (isHoneypot === true || canSell === false || risk >= 70) {
    recommendation = 'avoid'
  } else if (risk >= 40 || highTax === true) {
    recommendation = 'high_caution'
  } else if (!hasSecurity) {
    recommendation = 'insufficient_data'
  } else {
    recommendation = 'proceed_with_caution'
  }

  const summaryParts: string[] = []
  if (isHoneypot === true) summaryParts.push('Flagged as possible honeypot.')
  if (canSell === false) summaryParts.push('Sell path blocked or restricted.')
  if (highTax === true) summaryParts.push(`High tax: buy ${buyTax ?? '?'}% / sell ${sellTax ?? '?'}%.`)
  if (!hasSecurity) summaryParts.push('No security oracle data — liquidity only.')
  if (summaryParts.length === 0) {
    summaryParts.push(
      `Risk ${risk_level} (${risk}/100). Liquidity ~$${liquidityUsd != null ? Math.round(liquidityUsd) : 'n/a'}.`
    )
  }

  const report = {
    address: normalized,
    chain: 'base',
    chainId: 8453,
    risk_score: risk,
    risk_level,
    recommendation,
    data_quality,
    checks: {
      is_honeypot: isHoneypot,
      can_sell: canSell,
      high_tax: highTax,
      buy_tax_pct: buyTax,
      sell_tax_pct: sellTax,
      liquidity_locked: liquidityLocked,
      ownership_renounced: ownerRenounced,
      proxy_contract: isProxy,
      open_source: isOpenSource,
      mintable: isMintable
    },
    liquidity: {
      usd_value: liquidityUsd,
      pair: dex?.quoteToken?.symbol || null,
      dex: dex?.dexId || null,
      pair_address: dex?.pairAddress || null,
      volume_24h: dex?.volume?.h24 ?? null,
      price_usd: dex?.priceUsd ? parseFloat(dex.priceUsd) : null
    },
    contract: {
      verified: isOpenSource,
      owner: goplus?.owner_address || null,
      creator: goplus?.creator_address || null,
      holder_count: goplus?.holder_count ? Number(goplus.holder_count) : null
    },
    summary: summaryParts.join(' '),
    analyzed_at: new Date().toISOString(),
    source: {
      security: goplus ? 'GoPlus' : honeypot ? 'Honeypot.is' : null,
      security_secondary: goplus && honeypot ? 'Honeypot.is' : null,
      market: dex ? 'DexScreener' : null
    },
    cached: false,
    stale: false
  }

  // Write caches
  safetyMemory.set(normalized, { data: report, timestamp: now })
  try {
    await caches.default.put(
      safetyCacheKey(normalized),
      new Response(JSON.stringify(report), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `max-age=${SAFETY_CACHE_TTL_SECONDS}`
        }
      })
    )
  } catch (e) {
    console.warn('Safety CF cache write failed', e)
  }

  return report
}

// ======================================================
// Resilient Market Data
// ======================================================
async function getLiveCryptoPrices() {
  const now = Date.now()

  if (priceCache && now - priceCache.timestamp < MEMORY_TTL_MS) {
    return { ...priceCache.data, cached: true, stale: false }
  }

  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,virtual-protocol,aerodrome-finance,coinbase-wrapped-btc&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true',
      {
        headers: { 'User-Agent': 'x402-Finance-Worker/2.3', Accept: 'application/json' },
        signal: AbortSignal.timeout(8000)
      }
    )
    if (res.ok) {
      const raw = await res.json()
      const data = {
        bitcoin: {
          usd: raw.bitcoin?.usd ?? null,
          change_24h: raw.bitcoin?.usd_24h_change ?? null,
          last_updated: raw.bitcoin?.last_updated_at
            ? new Date(raw.bitcoin.last_updated_at * 1000).toISOString()
            : null
        },
        ethereum: {
          usd: raw.ethereum?.usd ?? null,
          change_24h: raw.ethereum?.usd_24h_change ?? null,
          last_updated: raw.ethereum?.last_updated_at
            ? new Date(raw.ethereum.last_updated_at * 1000).toISOString()
            : null
        },
        solana: {
          usd: raw.solana?.usd ?? null,
          change_24h: raw.solana?.usd_24h_change ?? null,
          last_updated: raw.solana?.last_updated_at
            ? new Date(raw.solana.last_updated_at * 1000).toISOString()
            : null
        },
        virtual: {
          usd: raw['virtual-protocol']?.usd ?? null,
          change_24h: raw['virtual-protocol']?.usd_24h_change ?? null,
          last_updated: raw['virtual-protocol']?.last_updated_at
            ? new Date(raw['virtual-protocol'].last_updated_at * 1000).toISOString()
            : null
        },
        aero: {
          usd: raw['aerodrome-finance']?.usd ?? null,
          change_24h: raw['aerodrome-finance']?.usd_24h_change ?? null,
          last_updated: raw['aerodrome-finance']?.last_updated_at
            ? new Date(raw['aerodrome-finance'].last_updated_at * 1000).toISOString()
            : null
        },
        cbbtc: {
          usd: raw['coinbase-wrapped-btc']?.usd ?? null,
          change_24h: raw['coinbase-wrapped-btc']?.usd_24h_change ?? null,
          last_updated: raw['coinbase-wrapped-btc']?.last_updated_at
            ? new Date(raw['coinbase-wrapped-btc'].last_updated_at * 1000).toISOString()
            : null
        },
        source: 'CoinGecko',
        fetched_at: new Date().toISOString(),
        cached: false,
        stale: false
      }
      priceCache = { data, timestamp: now }
      await caches.default.put(
        CACHE_KEY,
        new Response(JSON.stringify(data), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `max-age=${CACHE_TTL_SECONDS}`
          }
        })
      )
      return data
    } else {
      console.warn('CoinGecko status:', res.status)
    }
  } catch (e) {
    console.warn('CoinGecko failed', e)
  }

  try {
    const res = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD', {
      headers: { 'User-Agent': 'x402-Finance-Worker/2.3', Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    })
    if (res.ok) {
      const json = await res.json()
      const rates = json?.data?.rates || {}
      const data = {
        bitcoin: { usd: rates.BTC ? 1 / parseFloat(rates.BTC) : null, change_24h: null, last_updated: null },
        ethereum: { usd: rates.ETH ? 1 / parseFloat(rates.ETH) : null, change_24h: null, last_updated: null },
        solana: { usd: rates.SOL ? 1 / parseFloat(rates.SOL) : null, change_24h: null, last_updated: null },
        virtual: { usd: null, change_24h: null, last_updated: null },
        aero: { usd: null, change_24h: null, last_updated: null },
        cbbtc: { usd: rates.BTC ? 1 / parseFloat(rates.BTC) : null, change_24h: null, last_updated: null },
        source: 'Coinbase',
        fetched_at: new Date().toISOString(),
        cached: false,
        stale: false
      }
      priceCache = { data, timestamp: now }
      await caches.default.put(
        CACHE_KEY,
        new Response(JSON.stringify(data), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `max-age=${CACHE_TTL_SECONDS}`
          }
        })
      )
      return data
    }
  } catch (e) {
    console.warn('Coinbase failed', e)
  }

  try {
    const cached = await caches.default.match(CACHE_KEY)
    if (cached) {
      const data = await cached.json()
      return { ...data, cached: true, stale: true }
    }
  } catch (e) { }

  return {
    bitcoin: { usd: 65000, change_24h: null, last_updated: null },
    ethereum: { usd: 3400, change_24h: null, last_updated: null },
    solana: { usd: 145, change_24h: null, last_updated: null },
    virtual: { usd: 0.7, change_24h: null, last_updated: null },
    aero: { usd: 0.5, change_24h: null, last_updated: null },
    cbbtc: { usd: 65000, change_24h: null, last_updated: null },
    source: 'fallback-defaults',
    fetched_at: new Date().toISOString(),
    cached: false,
    stale: true,
    warning: 'Upstream price providers unavailable. Returning fallback estimates.'
  }
}

// ======================================================
// MCP Tool Definitions
// ======================================================
const MCP_TOOLS = [
  {
    name: 'get_market_data',
    description:
      'Get real-time USD prices for Bitcoin, Ethereum, Solana, VIRTUAL, AERO and cbBTC. Cost: $0.002 USDC via x402. LIVE.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: []
    }
  },
  {
    name: 'check_token_safety',
    description:
      'Analyze a Base token for honeypot risk, taxes, liquidity and ownership. Returns risk_score, recommendation, and data_quality. Cost: $0.04 USDC via x402. LIVE.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Token contract address on Base (0x...)',
          pattern: '^0x[a-fA-F0-9]{40}$'
        }
      },
      required: ['address']
    }
  },
  {
    name: 'analyze_holder_clusters',
    description:
      'Analyze holder concentration and coordinated wallet clusters for a Base token. Cost: $0.01 USDC via x402. COMING SOON – not accepting payments yet.',
    inputSchema: {
      type: 'object',
      properties: {
        address: {
          type: 'string',
          description: 'Token contract address on Base (0x...)',
          pattern: '^0x[a-fA-F0-9]{40}$'
        }
      },
      required: ['address']
    }
  }
]

const LIVE_MCP_TOOLS = new Set(['get_market_data', 'check_token_safety'])

// ======================================================
// MCP JSON-RPC Handler (POST /mcp)
// ======================================================
app.post('/mcp', async (c) => {
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32700, message: 'Parse error' },
        id: null
      },
      400
    )
  }

  const { jsonrpc, id, method, params } = body

  if (jsonrpc !== '2.0') {
    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32600, message: 'Invalid Request' },
        id: id ?? null
      },
      400
    )
  }

  if (method === 'initialize') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'x402-finance', version: '2.3.0' }
      }
    })
  }

  if (method === 'notifications/initialized') {
    return c.body(null, 204)
  }

  if (method === 'tools/list') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: { tools: MCP_TOOLS }
    })
  }

  if (method === 'tools/call') {
    const toolName = params?.name
    const args = params?.arguments || {}

    if (!toolName) {
      return c.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32602, message: 'Missing tool name' }
      })
    }

    const cleanName = toolName.replace(/^x402-finance\./, '')

    const toolConfig: Record<string, { amount: string; description: string; needsAddress: boolean }> = {
      get_market_data: {
        amount: PRICE_MARKET,
        description: 'Access to live crypto market data',
        needsAddress: false
      },
      check_token_safety: {
        amount: PRICE_SAFETY,
        description: 'Token safety analysis',
        needsAddress: true
      },
      analyze_holder_clusters: {
        amount: PRICE_CLUSTERS,
        description: 'Holder cluster analysis',
        needsAddress: true
      }
    }

    const config = toolConfig[cleanName]
    if (!config) {
      return c.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Unknown tool: ${toolName}` }
      })
    }

    if (!LIVE_MCP_TOOLS.has(cleanName)) {
      return c.json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: `${cleanName} is coming soon and is not accepting payments yet. Use get_market_data or check_token_safety.`
        }
      })
    }

    if (config.needsAddress) {
      const address = args.address
      if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
        return c.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Valid address parameter required (0x...)' }
        })
      }
    }

    const paymentSignature = args.paymentSignature

    if (!paymentSignature) {
      const resource = `mcp:${cleanName}`
      const challenge = createChallenge(
        resource,
        config.amount,
        config.description,
        cleanName === 'get_market_data' || cleanName === 'check_token_safety'
      )

      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'payment_required',
                  message:
                    'Payment required via x402. Sign the challenge and call the tool again with paymentSignature.',
                  challenge,
                  amount: config.amount,
                  amountUsd:
                    cleanName === 'get_market_data'
                      ? '0.002'
                      : cleanName === 'check_token_safety'
                        ? '0.04'
                        : '0.01',
                  network: NETWORK,
                  asset: USDC_BASE,
                  payTo: PAY_TO
                },
                null,
                2
              )
            }
          ],
          isError: false
        }
      })
    }

    try {
      let parsedPayload: any
      try {
        parsedPayload = JSON.parse(atob(paymentSignature))
      } catch {
        parsedPayload = JSON.parse(paymentSignature)
      }

      const requirements = createChallenge(
        `mcp:${cleanName}`,
        config.amount,
        config.description,
        true
      ).accepts[0]

      const verifyResult = await callFacilitator(c.env, '/platform/v2/x402/verify', {
        x402Version: 2,
        paymentPayload: parsedPayload,
        paymentRequirements: requirements
      })

      if (!verifyResult.isValid) {
        return c.json({
          jsonrpc: '2.0',
          id,
          error: {
            code: -32000,
            message: `Payment verification failed: ${verifyResult.invalidReason || verifyResult.error || 'Unknown'}`
          }
        })
      }

      const settleResult = await callFacilitator(c.env, '/platform/v2/x402/settle', {
        x402Version: 2,
        paymentPayload: parsedPayload,
        paymentRequirements: requirements
      })

      let toolData: any
      if (cleanName === 'get_market_data') {
        toolData = await getLiveCryptoPrices()
      } else if (cleanName === 'check_token_safety') {
        toolData = await analyzeTokenSafety(args.address)
      } else {
        return c.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32000, message: `Tool not executable: ${cleanName}` }
        })
      }

      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 'success',
                  tool: cleanName,
                  data: toolData,
                  settlement: {
                    success: true,
                    transaction: settleResult.transaction || settleResult.paymentResponse || null,
                    payer: verifyResult.payer || null,
                    amount: config.amount,
                    network: NETWORK
                  }
                },
                null,
                2
              )
            }
          ],
          isError: false
        }
      })
    } catch (err: any) {
      console.error('MCP payment error:', err)
      return c.json({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32000,
          message: err.message || 'Payment processing failed'
        }
      })
    }
  }

  return c.json({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: -32601, message: `Method not found: ${method}` }
  })
})

// ======================================================
// REST Routes
// ======================================================
app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'x402 Finance Paid API is live!',
    version: '2.3.0',
    protocol: 'x402-v2 + MCP'
  })
})

app.get('/.well-known/x402.json', (c) => {
  return c.json({
    x402Version: 2,
    name: 'x402 Finance API',
    description: 'Live crypto market data + token safety analysis on Base Mainnet via x402 V2.',
    endpoints: [
      {
        path: '/api/paid-content',
        method: 'GET',
        description: 'Real-time USD prices for BTC, ETH, SOL, VIRTUAL, AERO, cbBTC',
        price: { amount: PRICE_MARKET, asset: 'USDC', network: 'Base' },
        status: 'live'
      },
      {
        path: '/api/token-safety',
        method: 'GET',
        description:
          'Token safety: honeypot, tax, liquidity, ownership. Returns risk_score, recommendation, data_quality.',
        price: { amount: PRICE_SAFETY, asset: 'USDC', network: 'Base' },
        status: 'live',
        query: { address: '0x... token contract on Base' }
      },
      {
        path: '/api/holder-clusters',
        method: 'GET',
        description: 'Holder concentration & wallet cluster analysis (coming soon)',
        price: { amount: PRICE_CLUSTERS, asset: 'USDC', network: 'Base' },
        status: 'coming_soon'
      }
    ]
  })
})

app.get('/llms.txt', (c) => {
  const content = `# x402 Finance API

> Real-time crypto market data + token safety on Base Mainnet, protected by x402 V2 micropayments.

## Status
- **Market Data**: LIVE ($0.002 USDC)
- **Token Safety**: LIVE ($0.04 USDC) — GoPlus + Honeypot.is + DexScreener
- **Holder Clusters**: Coming soon (not accepting payments yet)

## Base URL
https://x402-paid-api.x402-finance.workers.dev

## Live Endpoints

### GET /api/paid-content
Live USD prices for BTC, ETH, SOL, VIRTUAL, AERO, cbBTC.
**Price:** 0.002 USDC (2000 atomic units)

### GET /api/token-safety?address=0x...
Honeypot / tax / liquidity / ownership analysis for a Base token.
Returns: risk_score (0-100), risk_level, recommendation (avoid | high_caution | proceed_with_caution | insufficient_data), data_quality (full | security_only | liquidity_only), checks, liquidity, summary.
**Price:** 0.04 USDC (40000 atomic units)
**Required query:** address (0x + 40 hex chars)

**Network:** Base Mainnet (eip155:8453)
**Asset:** USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)
**Pay To:** 0xE8bC82d53E45e61e07D84536970d695265A51CE4

### Payment Flow
1. Call endpoint → HTTP 402 + PAYMENT-REQUIRED
2. Sign and retry with PAYMENT-SIGNATURE
3. Receive data + PAYMENT-RESPONSE

## Discovery
- Manifest: /.well-known/x402.json
- MCP tools: /mcp-tools.json
- MCP JSON-RPC: POST /mcp
- Smithery: https://smithery.ai/servers/krbaric/x402-finance
- This file: /llms.txt

## Protocol
- x402 Version: 2
- Facilitator: Coinbase CDP
- Headers: PAYMENT-REQUIRED, PAYMENT-SIGNATURE, PAYMENT-RESPONSE
`
  return c.text(content, 200, {
    'Content-Type': 'text/plain; charset=utf-8'
  })
})

app.get('/mcp-tools.json', (c) => {
  return c.json({
    name: 'x402-finance',
    version: '2.3.0',
    description: 'x402-powered financial tools on Base Mainnet. LIVE: get_market_data + check_token_safety.',
    protocol: 'x402-v2',
    network: NETWORK,
    asset: USDC_BASE,
    payTo: PAY_TO,
    baseUrl: WORKER_ORIGIN,
    tools: MCP_TOOLS.map((t) => ({
      ...t,
      status: LIVE_MCP_TOOLS.has(t.name) ? 'live' : 'coming_soon',
      payment: {
        amount:
          t.name === 'get_market_data'
            ? PRICE_MARKET
            : t.name === 'check_token_safety'
              ? PRICE_SAFETY
              : PRICE_CLUSTERS,
        asset: 'USDC',
        network: NETWORK
      }
    }))
  })
})

app.get(
  '/api/paid-content',
  requireX402Payment(PRICE_MARKET, 'Access to live crypto market data', true),
  async (c) => {
    const prices = await getLiveCryptoPrices()
    return c.json({
      success: true,
      message: 'Live crypto market data (payment verified)',
      data: prices
    })
  }
)

app.get(
  '/api/token-safety',
  async (c, next) => {
    const address = c.req.query('address')
    if (!address || !/^0x[a-fA-F0-9]{40}$/.test(address)) {
      throw new HTTPException(400, {
        message: 'Valid contract address required (?address=0x...)'
      })
    }
    await next()
  },
  requireX402Payment(PRICE_SAFETY, 'Token safety analysis', true),
  async (c) => {
    try {
      const address = c.req.query('address')!
      const report = await analyzeTokenSafety(address)
      return c.json({
        success: true,
        message: 'Token safety analysis (payment verified)',
        data: report
      })
    } catch (err: any) {
      console.error('Token safety failed:', err)
      throw new HTTPException(502, {
        message: 'Failed to analyze token safety'
      })
    }
  }
)

app.get('/api/holder-clusters', (c) => {
  return c.json(
    {
      error: 'coming_soon',
      message: 'Holder Clusters is under development and not accepting payments yet.',
      status: 503
    },
    503
  )
})

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message, status: err.status }, err.status)
  }
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

app.notFound((c) => c.json({ error: 'Endpoint not found' }, 404))

export default app
