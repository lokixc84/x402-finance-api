# x402 Finance API – Agent Integration Skill

## Overview
This skill gives AI agents access to x402-gated financial tools on **Base Mainnet**.

| Tool | Endpoint | Price | Status |
| :--- | :--- | :--- | :--- |
| `get_market_data` | `/api/paid-content` | **$0.002 USDC** | **LIVE** |
| `check_token_safety` | `/api/token-safety?address=0x...` | $0.04 USDC | Coming soon |
| `analyze_holder_clusters` | `/api/holder-clusters?address=0x...` | $0.01 USDC | Coming soon |

**Only call `get_market_data` for production payments right now.**

---

## How to Add These Tools

### 1. Claude Desktop / Cursor / Windsurf (MCP)
Add the following to your MCP configuration (`mcpServers`):

```json
{
  "mcpServers": {
    "x402-finance": {
      "url": "https://x402-paid-api.x402-finance.workers.dev/mcp",
      "tools": ["get_market_data"]
    }
  }
}
```

### 2. Direct REST (x402 V2)

```bash
curl -i https://x402-paid-api.x402-finance.workers.dev/api/paid-content
```

Expect HTTP 402 + `PAYMENT-REQUIRED`. Sign and retry with `PAYMENT-SIGNATURE` using `@x402/fetch` + `@x402/evm`.

---

## Network

- Chain: Base Mainnet (`eip155:8453`)
- Asset: USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Pay to: `0xE8bC82d53E45e61e07D84536970d695265A51CE4`
- Protocol: x402 V2

## Discovery

- https://x402-paid-api.x402-finance.workers.dev/llms.txt
- https://x402-paid-api.x402-finance.workers.dev/mcp-tools.json
- https://smithery.ai/servers/krbaric/x402-finance
