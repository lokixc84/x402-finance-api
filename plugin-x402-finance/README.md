# plugin-x402-finance

ElizaOS plugin for **Base token safety** via [x402 Finance](https://x402-paid-api.x402-finance.workers.dev).

Pay-per-call with USDC on Base (x402 V2). No API key.

## What it does

| Action | Price | Description |
|--------|-------|-------------|
| `CHECK_TOKEN_SAFETY` | $0.04 USDC | Honeypot / tax / liquidity / ownership on Base |

Sources: GoPlus, Honeypot.is, DexScreener.

## Install

```bash
npm install plugin-x402-finance
# or
elizaos plugins add plugin-x402-finance