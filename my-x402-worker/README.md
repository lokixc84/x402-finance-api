# x402 Finance API

Real-time crypto market data and token safety analysis on Base Mainnet, protected by x402 V2 micropayments.

## Status

| Tool | Status | Price |
|------|--------|-------|
| Market Data (`/api/paid-content`) | **LIVE** | $0.002 USDC |
| Token Safety (`/api/token-safety`) | **LIVE** | $0.04 USDC |
| Holder Clusters (`/api/holder-clusters`) | Coming soon | $0.01 USDC |

## Live Endpoints

### Market Data

**GET** `https://x402-paid-api.x402-finance.workers.dev/api/paid-content`

Returns USD prices for:

- Bitcoin (BTC)
- Ethereum (ETH)
- Solana (SOL)
- Virtuals Protocol (VIRTUAL)
- Aerodrome (AERO)
- Coinbase Wrapped BTC (cbBTC)

**Price:** $0.002 USDC (2000 atomic units)

### Token Safety

**GET** `https://x402-paid-api.x402-finance.workers.dev/api/token-safety?address=0x...`

Analyzes a Base token for:

- Honeypot risk
- Buy / sell tax
- Liquidity depth (DexScreener)
- Ownership / proxy / mintable flags (when available)

**Required query:** `address` (Base token contract, `0x` + 40 hex chars)  
**Price:** $0.04 USDC (40000 atomic units)

### Shared payment config

**Network:** Base Mainnet (`eip155:8453`)  
**Asset:** USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`)  
**Pay To:** `0xE8bC82d53E45e61e07D84536970d695265A51CE4`

## Payment Flow

1. Call the endpoint → HTTP 402 + `PAYMENT-REQUIRED` header  
2. Sign and submit payment (`PAYMENT-SIGNATURE` header)  
3. Receive live data + `PAYMENT-RESPONSE` header  

## Discovery

- Manifest: `/.well-known/x402.json`
- MCP tools: `/mcp-tools.json`
- MCP JSON-RPC: `POST /mcp`
- LLM docs: `/llms.txt`
- Smithery: https://smithery.ai/servers/krbaric/x402-finance
- CDP Bazaar: indexed (payTo `0xE8bC82d53E45e61e07D84536970d695265A51CE4`)

## Quick Test (Node.js)

~~~bash
npm install @x402/fetch @x402/evm viem dotenv tsx
~~~

See `x402-client-test/test-payment.ts` for a full paid request example.

To test token safety, set `API_URL` to:

~~~text
https://x402-paid-api.x402-finance.workers.dev/api/token-safety?address=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
~~~

## ElizaOS plugin

Lightweight action plugin for ElizaOS agents.

### Local path

~~~bash
# from your ElizaOS project
npm install ../elizaos-plugin
# or absolute path to the elizaos-plugin folder
~~~

### Env (agent runtime)

~~~env
X402_PAYER_PRIVATE_KEY=0xYOUR_AGENT_WALLET_PRIVATE_KEY
~~~

Use a **payer** wallet with USDC on Base — not the merchant `payTo` address.

### Register in character / agent config

~~~typescript
import x402FinancePlugin from 'x402-elizaos-plugin'
// or: import x402FinancePlugin from '../path/to/elizaos-plugin/dist/index.js'

plugins: [x402FinancePlugin]
~~~

### Action

| Action | What it does | Price |
|--------|----------------|-------|
| `GET_MARKET_DATA` | Live BTC/ETH/SOL (+ more) via x402 | $0.002 USDC |

Package source: `elizaos-plugin/` in this monorepo.

## Links

- Live API: https://x402-paid-api.x402-finance.workers.dev  
- Docs (`llms.txt`): https://x402-paid-api.x402-finance.workers.dev/llms.txt  
- MCP tools: https://x402-paid-api.x402-finance.workers.dev/mcp-tools.json  
- X: https://x.com/x402_finance  
