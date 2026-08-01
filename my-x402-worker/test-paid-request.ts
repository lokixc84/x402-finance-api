import { wrapFetchWithPaymentFromConfig } from '@x402/fetch'
import { ExactEvmScheme, toClientEvmSigner } from '@x402/evm'
import { privateKeyToAccount } from 'viem/accounts'
import 'dotenv/config'

async function main() {
    const privateKey = process.env.PAYER_PRIVATE_KEY
    if (!privateKey) {
        throw new Error('Missing PAYER_PRIVATE_KEY in .env')
    }

    const account = privateKeyToAccount(privateKey as `0x${string}`)
    console.log('Payer address:', account.address)
    console.log('----------------------------------')

    // Convert viem account to an x402 client EVM signer
    const signer = toClientEvmSigner(account)

    // Use wrapFetchWithPaymentFromConfig to configure the client scheme
    const paidFetch = wrapFetchWithPaymentFromConfig(fetch, {
        schemes: [
            {
                network: 'eip155:8453', // Base Mainnet
                client: new ExactEvmScheme(signer)
            }
        ]
    })

    // Target: Token Safety ($0.05 USDC)
    const url = 'https://x402-paid-api.x402-finance.workers.dev/api/token-safety?address=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

    console.log('Target:', url)
    console.log('Sending paid request...\n')

    try {
        const response = await paidFetch(url, { method: 'GET' })
        console.log('Status:', response.status)
        console.log('PAYMENT-RESPONSE:', response.headers.get('PAYMENT-RESPONSE') ? 'Present ✅' : 'Missing')

        const data = await response.json()
        console.log('\nResponse:')
        console.log(JSON.stringify(data, null, 2))

        if (response.status === 200) {
            console.log('\n✅ SUCCESS – Payment settled and data received!')
        }
    } catch (err: any) {
        console.error('\n❌ Error:')
        console.error(err.message || err)
    }
}

main()