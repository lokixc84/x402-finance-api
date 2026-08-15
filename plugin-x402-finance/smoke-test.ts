import { wrapFetchWithPaymentFromConfig } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { privateKeyToAccount } from 'viem/accounts'
import 'dotenv/config'

async function main() {
    const pk = process.env.X402_PAYER_PRIVATE_KEY || process.env.PAYER_PRIVATE_KEY
    if (!pk) {
        throw new Error('Set X402_PAYER_PRIVATE_KEY (or PAYER_PRIVATE_KEY) in .env')
    }

    const address =
        process.argv[2] || '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

    const account = privateKeyToAccount(pk as `0x${string}`)
    console.log('Payer:', account.address)
    console.log('Token:', address)

    const scheme = new ExactEvmScheme(account as any)

    const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
        schemes: [
            {
                network: 'eip155:8453',
                client: scheme,
            },
        ],
    })

    const url = `https://x402-paid-api.x402-finance.workers.dev/api/token-safety?address=${address}`
    console.log('Sending paid token-safety request...')

    const res = await paidFetch(url, { method: 'GET' })
    const body = await res.json()

    console.log('Status:', res.status)
    console.log(
        'PAYMENT-RESPONSE:',
        res.headers.get('PAYMENT-RESPONSE') ? 'Present' : 'None'
    )
    console.log(JSON.stringify(body, null, 2))

    if (res.status === 200) {
        console.log('SUCCESS – token safety paid path works')
    }
}

main().catch((e) => {
    console.error(e)
    process.exit(1)
})