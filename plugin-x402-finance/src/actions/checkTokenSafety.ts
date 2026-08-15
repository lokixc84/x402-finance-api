import type {
    Action,
    HandlerCallback,
    IAgentRuntime,
    Memory,
    State,
    ActionResult,
} from '@elizaos/core'
import { wrapFetchWithPaymentFromConfig } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { privateKeyToAccount } from 'viem/accounts'

const SAFETY_URL =
    'https://x402-paid-api.x402-finance.workers.dev/api/token-safety'

function extractAddress(text: string): string | null {
    const m = text.match(/0x[a-fA-F0-9]{40}/)
    return m ? m[0] : null
}

export const checkTokenSafetyAction: Action = {
    name: 'CHECK_TOKEN_SAFETY',
    similes: [
        'RUG_CHECK',
        'HONEYPOT_CHECK',
        'TOKEN_SAFETY',
        'CAN_I_SELL_THIS',
        'CHECK_HONEYPOT',
    ],
    description:
        'Analyze a Base token for honeypot risk, taxes, liquidity and ownership via x402 Finance ($0.04 USDC on Base). Returns risk_score and recommendation.',

    validate: async (runtime: IAgentRuntime, _message: Memory) => {
        const pk = runtime.getSetting('X402_PAYER_PRIVATE_KEY')
        return !!pk
    },

    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        _state?: State,
        _options?: any,
        callback?: HandlerCallback
    ): Promise<ActionResult> => {
        const text = message.content?.text || ''
        const address =
            extractAddress(text) ||
            extractAddress(JSON.stringify(message.content || {}))

        if (!address) {
            const msg =
                'Need a Base token address (0x + 40 hex). Example: check token safety for 0x...'
            if (callback) {
                await callback({ text: msg })
            }
            return { success: false, text: msg }
        }

        const pk = runtime.getSetting('X402_PAYER_PRIVATE_KEY')
        if (!pk) {
            const msg =
                'X402_PAYER_PRIVATE_KEY is not set. Fund a Base wallet with USDC and set it in agent env.'
            if (callback) {
                await callback({ text: msg })
            }
            return { success: false, text: msg }
        }

        try {
            const account = privateKeyToAccount(pk as `0x${string}`)
            const scheme = new ExactEvmScheme(account as any)

            const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
                schemes: [
                    {
                        network: 'eip155:8453',
                        client: scheme,
                    },
                ],
            })

            const url = `${SAFETY_URL}?address=${address}`
            const res = await paidFetch(url, { method: 'GET' })
            const body = await res.json()

            if (!res.ok) {
                const errText = `Token safety call failed (${res.status}): ${JSON.stringify(body)}`
                if (callback) {
                    await callback({ text: errText })
                }
                return { success: false, text: errText }
            }

            const data = body.data || body
            const summary =
                `Token ${data.address || address}\n` +
                `Risk: ${data.risk_level} (${data.risk_score}/100)\n` +
                `Recommendation: ${data.recommendation}\n` +
                `Honeypot: ${data.checks?.is_honeypot}\n` +
                `Can sell: ${data.checks?.can_sell}\n` +
                `Buy tax: ${data.checks?.buy_tax_pct ?? 'n/a'}% | Sell tax: ${data.checks?.sell_tax_pct ?? 'n/a'}%\n` +
                `Liquidity: $${data.liquidity?.usd_value != null ? Math.round(data.liquidity.usd_value) : 'n/a'}\n` +
                `${data.summary || ''}`

            if (callback) {
                await callback({ text: summary, content: data })
            }

            return {
                success: true,
                text: summary,
                data,
            }
        } catch (err: any) {
            const errText = `CHECK_TOKEN_SAFETY error: ${err?.message || String(err)}`
            if (callback) {
                await callback({ text: errText })
            }
            return { success: false, text: errText }
        }
    },

    examples: [
        [
            {
                name: '{{user1}}',
                content: {
                    text: 'Is 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 a honeypot on Base?',
                },
            },
            {
                name: '{{agentName}}',
                content: {
                    text: 'Running CHECK_TOKEN_SAFETY on that Base address...',
                    actions: ['CHECK_TOKEN_SAFETY'],
                },
            },
        ],
    ],
}