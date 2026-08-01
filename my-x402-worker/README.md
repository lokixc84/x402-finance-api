# x402 Finance API

Real-time crypto market data on Base Mainnet, protected by x402 V2 micropayments.

## Status

| Tool | Status | Price |
|------|--------|-------|
| Market Data (`/api/paid-content`) | **LIVE** | $0.002 USDC |
| Token Safety | Coming soon | $0.04 USDC |
| Holder Clusters | Coming soon | $0.01 USDC |

## Live Endpoint

**GET** `https://x402-paid-api.x402-finance.workers.dev/api/paid-content`

Returns USD prices for:
- Bitcoin (BTC)
- Ethereum (ETH)
- Solana (SOL)
- Virtuals Protocol (VIRTUAL)
- Aerodrome (AERO)
- Coinbase Wrapped BTC (cbBTC)

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

## Quick Test (Node.js)

```bash
npm install @x402/fetch @x402/evm viem dotenv tsx