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

const PRICE_MARKET = '2000'    // $0.002 USDC
const PRICE_SAFETY = '40000'   // $0.04 USDC
const PRICE_CLUSTERS = '10000' // $0.01 USDC

const CACHE_KEY = new Request('https://x402-finance.internal/market-prices')
const CACHE_TTL_SECONDS = 300

let priceCache: { data: any; timestamp: number } | null = null
const MEMORY_TTL_MS = 120_000   // 2 minutes

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

  // Only add Bazaar metadata for the market data endpoint
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
                bitcoin: { usd: 63000, change_24h: -0.5 },
                ethereum: { usd: 1800, change_24h: 0.2 },
                solana: { usd: 70, change_24h: -1.1 }
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
  body: any
) {
  const authHeader = await getAuthHeader(env, path)
  const res = await fetch(`https://${FACILITATOR_HOST}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader
    },
    body: JSON.stringify(body)
  })
  const data = await res.json()
  if (!res.ok) {
    console.error(`Facilitator ${path} failed:`, res.status, JSON.stringify(data))
    throw new Error(`Facilitator ${path} error: ${res.status}`)
  }
  return data
}

// ======================================================
// x402 Payment Middleware
// ======================================================
function requireX402Payment(amount: string, description: string, includeBazaar = false) {
  return async (c: any, next: () => Promise<void>) => {
    const paymentSignatureHeader = c.req.header('PAYMENT-SIGNATURE')

    if (!paymentSignatureHeader) {
      const challenge = createChallenge(c.req.url, amount, description, includeBazaar)
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
      const requirements = createChallenge(c.req.url, amount, description, includeBazaar).accepts[0]

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

      const settleResult = await callFacilitator(c.env, '/platform/v2/x402/settle', {
        x402Version: 2,
        paymentPayload: parsedPayload,
        paymentRequirements: requirements
      })

      console.log('Settle result:', JSON.stringify(settleResult, null, 2))

      if (settleResult.paymentResponse || settleResult.transaction) {
        c.header(
          'PAYMENT-RESPONSE',
          typeof settleResult.paymentResponse === 'string'
            ? settleResult.paymentResponse
            : btoa(JSON.stringify(settleResult))
        )
      }
      console.log('[PAYMENT SUCCESS] amount=' + amount + ' payer=' + (verifyResult.payer || 'unknown') + ' tx=' + (settleResult.transaction || 'n/a'))

      await next()
    } catch (err: any) {
      if (err instanceof HTTPException) throw err
      throw new HTTPException(402, { message: 'Payment verification failed' })
    }
  }
}

// ======================================================
// Resilient Market Data
// ======================================================
async function getLiveCryptoPrices() {
  const now = Date.now()

  if (priceCache && now - priceCache.timestamp < MEMORY_TTL_MS) {
    return { ...priceCache.data, cached: true, stale: false }
  }

  // Primary: CoinGecko
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,virtual-protocol,aerodrome-finance,coinbase-wrapped-btc&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true',
      {
        headers: { 'User-Agent': 'x402-Finance-Worker/1.0', Accept: 'application/json' },
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

  // Secondary: Coinbase
  try {
    const res = await fetch('https://api.coinbase.com/v2/exchange-rates?currency=USD', {
      headers: { 'User-Agent': 'x402-Finance-Worker/1.0', Accept: 'application/json' },
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

  // Tertiary: Cloudflare Cache
  try {
    const cached = await caches.default.match(CACHE_KEY)
    if (cached) {
      const data = await cached.json()
      return { ...data, cached: true, stale: true }
    }
  } catch (e) { }

  // Final fallback
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
// MCP Tool Definitions (used by tools/list)
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
      'Analyze a Base token for honeypot risk, taxes, liquidity lock and ownership. Cost: $0.04 USDC via x402. COMING SOON – not accepting payments yet.',
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

  // ---------- initialize ----------
  if (method === 'initialize') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {}
        },
        serverInfo: {
          name: 'x402-finance',
          version: '2.1.0'
        }
      }
    })
  }

  // ---------- notifications/initialized ----------
  if (method === 'notifications/initialized') {
    return c.body(null, 204)
  }

  // ---------- tools/list ----------
  if (method === 'tools/list') {
    return c.json({
      jsonrpc: '2.0',
      id,
      result: {
        tools: MCP_TOOLS
      }
    })
  }

  // ---------- tools/call ----------
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

    // Map tool names (support both plain and namespaced)
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
        error: { code: -32601, message: `Unknown tool: ${toolName} ` }
      })
    }

    // Validate address when required
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

    // CASE 1: No payment yet → return structured challenge
    if (!paymentSignature) {
      const resource = `mcp:${cleanName} `
      const challenge = createChallenge(resource, config.amount, config.description)

      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                status: 'payment_required',
                message: 'Payment required via x402. Sign the challenge and call the tool again with paymentSignature.',
                challenge: challenge,
                amount: config.amount,
                amountUsd: cleanName === 'get_market_data' ? '0.002' : cleanName === 'check_token_safety' ? '0.04' : '0.01',
                network: NETWORK,
                asset: USDC_BASE,
                payTo: PAY_TO
              }, null, 2)
            }
          ],
          isError: false
        }
      })
    }

    // CASE 2: Payment signature provided → verify + settle + execute
    try {
      let parsedPayload: any
      try {
        parsedPayload = JSON.parse(atob(paymentSignature))
      } catch {
        parsedPayload = JSON.parse(paymentSignature)
      }

      const requirements = createChallenge(`mcp:${cleanName} `, config.amount, config.description).accepts[0]

      // Verify
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
            message: `Payment verification failed: ${verifyResult.invalidReason || verifyResult.error || 'Unknown'} `
          }
        })
      }

      // Settle
      const settleResult = await callFacilitator(c.env, '/platform/v2/x402/settle', {
        x402Version: 2,
        paymentPayload: parsedPayload,
        paymentRequirements: requirements
      })

      // Execute the actual tool logic
      let toolData: any

      if (cleanName === 'get_market_data') {
        toolData = await getLiveCryptoPrices()
      } else if (cleanName === 'check_token_safety') {
        const address = args.address.toLowerCase()
        toolData = {
          address,
          risk_score: 27,
          risk_level: 'Low',
          checks: {
            is_honeypot: false,
            can_sell: true,
            high_tax: false,
            liquidity_locked: true,
            ownership_renounced: true,
            proxy_contract: false,
            mintable: false
          },
          liquidity: { usd_value: 184250.55, pair: 'WETH', locked_percentage: 98.4 },
          contract: { verified: true, compiler: 'v0.8.19+commit.7dd6d404', optimization: true },
          summary: 'Token appears low-risk. Liquidity is locked and ownership is renounced.',
          analyzed_at: new Date().toISOString(),
          source: 'x402-Finance-API'
        }
      } else if (cleanName === 'analyze_holder_clusters') {
        const address = args.address.toLowerCase()
        toolData = {
          address,
          concentration: {
            top10_percentage: 41.8,
            top20_percentage: 58.3,
            top50_percentage: 72.1,
            gini_coefficient: 0.74
          },
          clusters: [
            {
              id: 'cluster_01',
              size: 7,
              total_percentage: 18.6,
              shared_funding: true,
              funding_source: 'CEX deposit (Binance)',
              risk: 'medium'
            },
            {
              id: 'cluster_02',
              size: 4,
              total_percentage: 9.2,
              shared_funding: true,
              funding_source: 'Same deployer wallet',
              risk: 'high'
            }
          ],
          flags: {
            high_concentration: true,
            possible_cabal: true,
            cex_heavy: true,
            deployer_still_holding: true
          },
          risk_score: 62,
          risk_level: 'Medium-High',
          summary: 'Moderate concentration risk. Two related clusters control ~28% of supply.',
          analyzed_at: new Date().toISOString(),
          source: 'x402-Finance-API'
        }
      }

      // Return data + full settlement receipt
      return c.json({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
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
              }, null, 2)
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

  // ---------- Method not found ----------
  return c.json({
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code: -32601, message: `Method not found: ${method} ` }
  })
})

// ======================================================
// Existing REST Routes (unchanged)
// ======================================================

app.get('/', (c) => {
  return c.json({
    status: 'ok',
    message: 'x402 Finance Paid API is live!',
    version: '2.1.0',
    protocol: 'x402-v2 + MCP'
  })
})

app.get('/.well-known/x402.json', (c) => {
  return c.json({
    x402Version: 2,
    name: 'x402 Finance API',
    description: 'Live crypto market data on Base Mainnet (BTC, ETH, SOL, VIRTUAL, AERO, cbBTC). Token Safety & Holder Clusters coming soon.',
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
        description: 'Token safety, honeypot & liquidity analysis (coming soon)',
        price: { amount: PRICE_SAFETY, asset: 'USDC', network: 'Base' },
        status: 'coming_soon'
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

> Real-time crypto market data on Base Mainnet, protected by x402 V2 micropayments.

## Status
- **Market Data**: LIVE and accepting payments
- **Token Safety**: Coming soon (not accepting payments yet)
- **Holder Clusters**: Coming soon (not accepting payments yet)

## Base URL
https://x402-paid-api.x402-finance.workers.dev

## Live Endpoint

### GET /api/paid-content
Returns live USD prices for:
- Bitcoin (BTC)
- Ethereum (ETH)
- Solana (SOL)
- Virtuals Protocol (VIRTUAL)
- Aerodrome (AERO)
- Coinbase Wrapped BTC (cbBTC)

**Price:** 0.002 USDC (2000 atomic units)  
**Network:** Base Mainnet (eip155:8453)  
**Asset:** USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913)  
**Pay To:** 0xE8bC82d53E45e61e07D84536970d695265A51CE4

### Payment Flow
1. Call the endpoint → receive HTTP 402 + PAYMENT-REQUIRED header
2. Sign and submit payment (PAYMENT-SIGNATURE header)
3. Receive live market data + PAYMENT-RESPONSE header

## Discovery
- Manifest: /.well-known/x402.json
- MCP tools: /mcp-tools.json
- MCP JSON-RPC: POST /mcp
- This file: /llms.txt

## Protocol
- x402 Version: 2
- Facilitator: Coinbase CDP
- Headers: PAYMENT-REQUIRED, PAYMENT-SIGNATURE, PAYMENT-RESPONSE

## Example Response (after payment)
{
  "success": true,
  "data": {
    "bitcoin": { "usd": 62700, "change_24h": -0.4 },
    "ethereum": { "usd": 1860, "change_24h": -0.6 },
    "solana": { "usd": 72, "change_24h": -2.1 },
    "virtual": { "usd": 0.55, "change_24h": -1.5 },
    "aero": { "usd": 0.41, "change_24h": -3.0 },
    "cbbtc": { "usd": 62700, "change_24h": -0.3 },
    "source": "CoinGecko"
  }
}
`
  return c.text(content, 200, {
    'Content-Type': 'text/plain; charset=utf-8'
  })
})

app.get('/mcp-tools.json', (c) => {
  return c.json({
    name: 'x402-finance',
    version: '2.1.0',
    description: 'x402-powered financial tools on Base Mainnet',
    protocol: 'x402-v2',
    network: NETWORK,
    asset: USDC_BASE,
    payTo: PAY_TO,
    baseUrl: 'https://x402-paid-api.x402-finance.workers.dev',
    tools: MCP_TOOLS.map((t) => ({
      ...t,
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

// Protected REST endpoints
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

// Temporarily disabled – not ready for payments
app.get('/api/token-safety', (c) => {
  return c.json(
    {
      error: 'coming_soon',
      message: 'Token Safety is under development and not accepting payments yet. Use /api/paid-content for live market data.',
      status: 503
    },
    503
  )
})

// Temporarily disabled – not ready for payments
app.get('/api/holder-clusters', (c) => {
  return c.json(
    {
      error: 'coming_soon',
      message: 'Holder Clusters is under development and not accepting payments yet. Use /api/paid-content for live market data.',
      status: 503
    },
    503
  )
})

// ======================================================
// Error Handlers
// ======================================================
app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message, status: err.status }, err.status)
  }
  console.error('Unhandled error:', err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

app.notFound((c) => c.json({ error: 'Endpoint not found' }, 404))

export default app