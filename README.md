# x402 Finance API

Live crypto data and token risk tools on **Base Mainnet**, monetized with **x402 V2** micropayments (USDC).

No API keys. Agents pay per call.

## Live endpoint

**Base URL:** https://x402-paid-api.x402-finance.workers.dev

| Route | Price | Status |
|-------|-------|--------|
| `GET /api/paid-content` | $0.002 USDC | LIVE |
| `GET /api/token-safety?address=0x...` | $0.04 USDC | LIVE |
| `GET /api/holder-clusters?address=0x...` | $0.01 USDC | Coming soon |

## Discovery

- Docs (agents): https://x402-paid-api.x402-finance.workers.dev/llms.txt
- MCP tools: https://x402-paid-api.x402-finance.workers.dev/mcp-tools.json
- MCP JSON-RPC: `POST https://x402-paid-api.x402-finance.workers.dev/mcp`
- Manifest: https://x402-paid-api.x402-finance.workers.dev/.well-known/x402.json
- Smithery: https://smithery.ai/servers/krbaric/x402-finance

## ElizaOS plugin

Install:

```bash
npm install plugin-x402-finance
```

Action: `CHECK_TOKEN_SAFETY` — Base honeypot / tax / liquidity ($0.04 USDC via x402).

- npm: https://www.npmjs.com/package/plugin-x402-finance
- Registry PR: https://github.com/elizaOS/eliza/pull/2017
- Plugin source: `/plugin-x402-finance`

In your agent config:

```typescript
import x402FinancePlugin from 'plugin-x402-finance'

plugins: [x402FinancePlugin]
```

Set `X402_PAYER_PRIVATE_KEY` to a Base wallet funded with USDC.

## Network

- Chain: Base Mainnet (`eip155:8453`)
- Asset: USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Pay to: `0xE8bC82d53E45e61e07D84536970d695265A51CE4`
- Protocol: x402 V2 (PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE)

## Quick test

```bash
curl -i "https://x402-paid-api.x402-finance.workers.dev/api/token-safety?address=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
```

Expect HTTP 402 with a `PAYMENT-REQUIRED` header until payment is attached.
