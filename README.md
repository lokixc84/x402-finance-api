# x402 Finance API

Live crypto market data on **Base Mainnet**, monetized with **x402 V2** micropayments (USDC).

No API keys. Agents pay per call.

## Live endpoint

**Base URL:** https://x402-paid-api.x402-finance.workers.dev

| Route | Price | Status |
|-------|-------|--------|
| `GET /api/paid-content` | $0.002 USDC | LIVE |
| `GET /api/token-safety` | $0.04 USDC | Coming soon |
| `GET /api/holder-clusters` | $0.01 USDC | Coming soon |

## Discovery

- Docs (agents): https://x402-paid-api.x402-finance.workers.dev/llms.txt
- MCP tools: https://x402-paid-api.x402-finance.workers.dev/mcp-tools.json
- MCP JSON-RPC: `POST https://x402-paid-api.x402-finance.workers.dev/mcp`
- Manifest: https://x402-paid-api.x402-finance.workers.dev/.well-known/x402.json
- Smithery: https://smithery.ai/servers/krbaric/x402-finance

## Network

- Chain: Base Mainnet (`eip155:8453`)
- Asset: USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Pay to: `0xE8bC82d53E45e61e07D84536970d695265A51CE4`
- Protocol: x402 V2 (PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE)

## Quick test

```bash
curl -i https://x402-paid-api.x402-finance.workers.dev/api/paid-content
