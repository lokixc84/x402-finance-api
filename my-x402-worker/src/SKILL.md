# x402 Finance API – Agent Integration Skill

## Overview
This skill gives AI agents access to three x402-gated financial analysis tools on Base Mainnet:

| Tool | Endpoint | Price | Description |
| :--- | :--- | :--- | :--- |
| `get_market_data` | `/api/paid-content` | **0.002 USDC** | Live BTC, ETH, SOL prices + 24h change & source metadata |
| `check_token_safety` | `/api/token-safety?address=0x...` | **0.04 USDC** | ERC-20 contract risk analysis (honeypot, liquidity lock, ownership) |
| `analyze_holder_clusters` | `/api/holder-clusters?address=0x...` | **0.01 USDC** | Holder concentration and coordinated wallet cluster/cabal detection |

---

## How to Add These Tools

### 1. Claude Desktop / Cursor / Windsurf (MCP)
Add the following to your MCP configuration (`mcpServers`):

```json
{
  "mcpServers": {
    "x402-finance": {
      "url": "[https://x402-paid-api.x402-finance.workers.dev](https://x402-paid-api.x402-finance.workers.dev)",
      "tools": [
        "get_market_data",
        "check_token_safety",
        "analyze_holder_clusters"
      ]
    }
  }
}