import { privateKeyToAccount } from 'viem/accounts'
import { ExactEvmScheme } from '@x402/evm'
import 'dotenv/config'

async function main() {
    const MCP_URL = 'https://x402-paid-api.x402-finance.workers.dev/mcp'
    const privateKey = process.env.PAYER_PRIVATE_KEY

    if (!privateKey) {
        throw new Error('Missing PAYER_PRIVATE_KEY in .env')
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`)
    console.log('Payer address:', account.address)
    console.log('----------------------------------')

    // 1. Get the challenge
    console.log('1. Requesting challenge from MCP...')
    const challengeRes = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
                name: 'get_market_data',
                arguments: {}
            }
        })
    })

    const challengeJson = await challengeRes.json()
    const textContent = challengeJson?.result?.content?.[0]?.text

    if (!textContent) {
        console.error('No challenge received')
        return
    }

    const parsed = JSON.parse(textContent)
    if (parsed.status !== 'payment_required') {
        console.error('Expected payment_required')
        return
    }

    console.log('✅ Challenge received')
    console.log('Amount:', parsed.amountUsd, 'USDC')

    const paymentRequirements = parsed.challenge.accepts[0]

    // 2. Create payment payload
    console.log('\n2. Creating payment payload...')
    const scheme = new ExactEvmScheme({ account })

    let paymentPayload: any
    try {
        // Try the most common method names used in @x402/evm
        if (typeof (scheme as any).createPaymentPayload === 'function') {
            paymentPayload = await (scheme as any).createPaymentPayload(paymentRequirements)
        } else if (typeof (scheme as any).createPayment === 'function') {
            paymentPayload = await (scheme as any).createPayment(paymentRequirements)
        } else {
            console.log('Available methods on scheme:', Object.getOwnPropertyNames(Object.getPrototypeOf(scheme)))
            throw new Error('Could not find createPaymentPayload method')
        }
    } catch (err: any) {
        console.error('Error creating payment payload:', err.message)
        console.log('Scheme keys:', Object.keys(scheme))
        return
    }

    console.log('✅ Payment payload created')

    // Encode it the same way the REST path expects
    const paymentSignature = typeof paymentPayload === 'string'
        ? paymentPayload
        : btoa(JSON.stringify(paymentPayload))

    // 3. Second call with paymentSignature
    console.log('\n3. Calling tool again with paymentSignature...')
    const paidRes = await fetch(MCP_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
                name: 'get_market_data',
                arguments: {
                    paymentSignature
                }
            }
        })
    })

    const paidJson = await paidRes.json()
    console.log('\nFinal response:')
    console.log(JSON.stringify(paidJson, null, 2))
}

main().catch(console.error)