import { wrapFetchWithPaymentFromConfig } from '@x402/fetch'
import { ExactEvmScheme } from '@x402/evm/exact/client'
import { privateKeyToAccount } from 'viem/accounts'
import 'dotenv/config'

async function main() {
    const API_URL = 'https://x402-paid-api.x402-finance.workers.dev/api/paid-content'
    const privateKey = process.env.PAYER_PRIVATE_KEY

    if (!privateKey) {
        throw new Error('Missing PAYER_PRIVATE_KEY in .env')
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`)
    console.log('Payer address :', account.address)
    console.log('Target        :', API_URL)
    console.log('----------------------------------')

    // Import ExactEvmScheme specifically from '@x402/evm/exact/client'
    // Pass account directly inside constructor
    const scheme = new ExactEvmScheme(account as any)

    const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
        schemes: [
            {
                network: 'eip155:8453', // Base Mainnet
                client: scheme
            }
        ]
    })

    console.log('Sending paid request (x402 will handle 402 → sign → retry)...')

    try {
        const response = await paidFetch(API_URL, {
            method: 'GET'
        })

        console.log('\nStatus:', response.status)
        console.log(
            'PAYMENT-RESPONSE header:',
            response.headers.get('PAYMENT-RESPONSE') ? 'Present ✅' : 'None'
        )

        const data = await response.json()
        console.log('\nResponse body:')
        console.log(JSON.stringify(data, null, 2))

        if (response.status === 200) {
            console.log('\n✅ SUCCESS – Payment settled and live market data received!')
        } else {
            console.log('\n⚠️ Received non-200 status')
        }
    } catch (err: any) {
        console.error('\n❌ Error during paid request:')
        console.error(err.message || err)
    }
}

main()