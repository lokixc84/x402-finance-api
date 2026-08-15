// src/actions/checkTokenSafety.ts
import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
var SAFETY_URL = "https://x402-paid-api.x402-finance.workers.dev/api/token-safety";
function extractAddress(text) {
  const m = text.match(/0x[a-fA-F0-9]{40}/);
  return m ? m[0] : null;
}
var checkTokenSafetyAction = {
  name: "CHECK_TOKEN_SAFETY",
  similes: [
    "RUG_CHECK",
    "HONEYPOT_CHECK",
    "TOKEN_SAFETY",
    "CAN_I_SELL_THIS",
    "CHECK_HONEYPOT"
  ],
  description: "Analyze a Base token for honeypot risk, taxes, liquidity and ownership via x402 Finance ($0.04 USDC on Base). Returns risk_score and recommendation.",
  validate: async (runtime, _message) => {
    const pk = runtime.getSetting("X402_PAYER_PRIVATE_KEY");
    return !!pk;
  },
  handler: async (runtime, message, _state, _options, callback) => {
    const text = message.content?.text || "";
    const address = extractAddress(text) || extractAddress(JSON.stringify(message.content || {}));
    if (!address) {
      const msg = "Need a Base token address (0x + 40 hex). Example: check token safety for 0x...";
      if (callback) {
        await callback({ text: msg });
      }
      return { success: false, text: msg };
    }
    const pk = runtime.getSetting("X402_PAYER_PRIVATE_KEY");
    if (!pk) {
      const msg = "X402_PAYER_PRIVATE_KEY is not set. Fund a Base wallet with USDC and set it in agent env.";
      if (callback) {
        await callback({ text: msg });
      }
      return { success: false, text: msg };
    }
    try {
      const account = privateKeyToAccount(pk);
      const scheme = new ExactEvmScheme(account);
      const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
        schemes: [
          {
            network: "eip155:8453",
            client: scheme
          }
        ]
      });
      const url = `${SAFETY_URL}?address=${address}`;
      const res = await paidFetch(url, { method: "GET" });
      const body = await res.json();
      if (!res.ok) {
        const errText = `Token safety call failed (${res.status}): ${JSON.stringify(body)}`;
        if (callback) {
          await callback({ text: errText });
        }
        return { success: false, text: errText };
      }
      const data = body.data || body;
      const summary = `Token ${data.address || address}
Risk: ${data.risk_level} (${data.risk_score}/100)
Recommendation: ${data.recommendation}
Honeypot: ${data.checks?.is_honeypot}
Can sell: ${data.checks?.can_sell}
Buy tax: ${data.checks?.buy_tax_pct ?? "n/a"}% | Sell tax: ${data.checks?.sell_tax_pct ?? "n/a"}%
Liquidity: $${data.liquidity?.usd_value != null ? Math.round(data.liquidity.usd_value) : "n/a"}
${data.summary || ""}`;
      if (callback) {
        await callback({ text: summary, content: data });
      }
      return {
        success: true,
        text: summary,
        data
      };
    } catch (err) {
      const errText = `CHECK_TOKEN_SAFETY error: ${err?.message || String(err)}`;
      if (callback) {
        await callback({ text: errText });
      }
      return { success: false, text: errText };
    }
  },
  examples: [
    [
      {
        name: "{{user1}}",
        content: {
          text: "Is 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 a honeypot on Base?"
        }
      },
      {
        name: "{{agentName}}",
        content: {
          text: "Running CHECK_TOKEN_SAFETY on that Base address...",
          actions: ["CHECK_TOKEN_SAFETY"]
        }
      }
    ]
  ]
};

// src/index.ts
var x402FinancePlugin = {
  name: "x402-finance",
  description: "Base token safety via x402 Finance API \u2014 honeypot, tax, liquidity ($0.04 USDC per call, no API key)",
  actions: [checkTokenSafetyAction],
  providers: [],
  evaluators: [],
  services: []
};
var index_default = x402FinancePlugin;
export {
  checkTokenSafetyAction,
  index_default as default,
  x402FinancePlugin
};
