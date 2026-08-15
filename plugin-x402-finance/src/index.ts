import type { Plugin } from '@elizaos/core'
import { checkTokenSafetyAction } from './actions/checkTokenSafety'

export const x402FinancePlugin: Plugin = {
    name: 'x402-finance',
    description:
        'Base token safety via x402 Finance API — honeypot, tax, liquidity ($0.04 USDC per call, no API key)',
    actions: [checkTokenSafetyAction],
    providers: [],
    evaluators: [],
    services: [],
}

export default x402FinancePlugin
export { checkTokenSafetyAction }