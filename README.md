# x402 Finance API

**Real-time crypto market data protected by x402 micropayments.**

This API provides on-demand cryptocurrency price data managed by the **x402 payment protocol**. AI agents and autonomous scripts can pay per request seamlessly using USDC on Base Sepolia.

**Live Endpoint:** [https://x402-finance-api.onrender.com](https://x402-finance-api.onrender.com)

---

## API Endpoints

### `GET /crypto/{symbol}`
Returns the current market price of a cryptocurrency.

* **Parameters:** 
  * `symbol` (path string) — The asset ID (e.g., `bitcoin`, `ethereum`, `solana`).

#### Example Verified Response:
```json
{
  "symbol": "BITCOIN",
  "price_usd": 64585,
  "timestamp": "2026-07-19T10:36:59.203081",
  "source": "CoinGecko",
  "cached": false,
  "cache_age_seconds": 0
}