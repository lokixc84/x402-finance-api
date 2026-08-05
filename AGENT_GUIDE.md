# AGENT_GUIDE.md

## Overview

**Name:** x402 Finance API  
**Purpose:** Real-time crypto market data for autonomous agents  
**Network:** Base Mainnet (`eip155:8453`)  
**Protocol:** x402 V2  
**Pricing:** $0.002 USDC per market-data call  
**Live base:** https://x402-paid-api.x402-finance.workers.dev

No API keys. Agents pay per request with USDC on Base.

---

## Live endpoint

### GET /api/paid-content
Returns live USD prices (BTC, ETH, SOL and related).

- **Price:** $0.002 USDC (2000 atomic units)
- **Asset:** USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- **Pay to:** `0xE8bC82d53E45e61e07D84536970d695265A51CE4`

### Payment flow (x402 V2)

1. Call the endpoint with no payment header → HTTP **402**
2. Read `PAYMENT-REQUIRED` (Base64 JSON challenge)
3. Sign payment (EIP-3009 / exact scheme) via `@x402/evm` or compatible client
4. Retry with `PAYMENT-SIGNATURE` header
5. Receive data + `PAYMENT-RESPONSE` settlement receipt

---

## Discovery URLs

| Resource | URL |
|----------|-----|
| llms.txt | https://x402-paid-api.x402-finance.workers.dev/llms.txt |
| MCP tools | https://x402-paid-api.x402-finance.workers.dev/mcp-tools.json |
| MCP JSON-RPC | POST https://x402-paid-api.x402-finance.workers.dev/mcp |
| Manifest | https://x402-paid-api.x402-finance.workers.dev/.well-known/x402.json |
| Smithery | https://smithery.ai/servers/krbaric/x402-finance |

---

## Recommended client stack

```bash
npm install @x402/fetch @x402/evm viem dotenv
