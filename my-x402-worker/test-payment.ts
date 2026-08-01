import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// A test EVM wallet private key holding a small amount of USDC on Base
const TEST_PRIVATE_KEY = "0xa96acb844c545e64c9d08b9025836e2845e8f61bdce99c345965ad1d68993d72";

const account = privateKeyToAccount(TEST_PRIVATE_KEY as `0x${string}`);

console.log("🤖 Agent Wallet Address:", account.address);

// Initialize x402Client and register the EVM scheme
const client = new x402Client();
registerExactEvmScheme(client, { signer: account });

// Wrap standard fetch with the configured x402 client
const paidFetch = wrapFetchWithPayment(fetch, client);

async function runTest() {
    console.log("📡 Sending x402 Request to Market Data ($0.002 USDC)...");

    try {
        const res = await paidFetch("https://x402-paid-api.x402-finance.workers.dev/api/paid-content");
        const data = await res.json();

        console.log("✅ SUCCESS! Server Response (200 OK):");
        console.log(JSON.stringify(data, null, 2));
    } catch (err: any) {
        console.error("❌ Test Failed:", err.message || err);
    }
}

runTest();