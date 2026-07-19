# AGENT_GUIDE.md

## Project Overview

**Name:** x402 Finance API  
**Purpose:** Real-time cryptocurrency price data protected by the x402 micropayment protocol.  
**Target Users:** Autonomous AI agents and agentic systems that require payment-native data access.  
**Current Network:** Base Sepolia (testnet)  
**Pricing Model:** Pay-per-request (0.01 USDC per successful data retrieval)  
**Live Endpoint:** https://x402-finance-api.onrender.com

This service allows AI agents to autonomously purchase real-time market data using the x402 HTTP payment standard without human intervention.

---

## x402 Capability Declaration

**Protocol:** x402 (HTTP 402 Payment Required)  
**Payment Asset:** USDC  
**Network:** Base Sepolia  
**Price per Request:** 0.01 USDC (exact)  
**Required Header:** `x-payment-tx`  
**Payment Flow:**  
1. Client calls endpoint without payment header → receives HTTP 402  
2. Client sends exactly 0.01 USDC to the address provided in the 402 response  
3. Client retries the original request with the transaction hash in the `x-payment-tx` header  
4. Server verifies the transaction on-chain and returns data if valid

**Supported Endpoints:**
- `GET /crypto/{symbol}` — Returns current price for a single cryptocurrency (e.g., `bitcoin`, `ethereum`, `solana`)

---

## Autonomous Agent Integration Pattern

### Recommended Flow for AI Agents

1. Call the desired endpoint.
2. If HTTP status is `402`, parse the `payment` object from the response body.
3. Execute an on-chain USDC transfer of the exact amount to the specified recipient.
4. Wait for transaction confirmation.
5. Retry the original request, including the transaction hash in the `x-payment-tx` header.

### Reference Implementation (Python)

```python
import os
import requests
from web3 import Web3
from eth_account import Account
from dotenv import load_dotenv

load_dotenv()

API_URL = "https://x402-finance-api.onrender.com/crypto/bitcoin"
PRIVATE_KEY = os.getenv("PRIVATE_KEY")
RPC_URL = "https://sepolia.base.org"
USDC_CONTRACT = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"

w3 = Web3(Web3.HTTPProvider(RPC_URL))


def get_data_with_x402_payment():
    if not PRIVATE_KEY:
        raise ValueError("PRIVATE_KEY not set in environment")

    # Step 1: Initial request
    response = requests.get(API_URL)

    if response.status_code != 402:
        return response.json()

    # Step 2: Parse payment requirements
    payment = response.json()["payment"]
    recipient = payment["to"]
    amount_usdc = float(payment["amount"])

    # Step 3: Send payment
    tx_hash = _send_usdc(recipient, amount_usdc)

    # Step 4: Retry with payment proof
    headers = {"x-payment-tx": tx_hash}
    final_response = requests.get(API_URL, headers=headers)

    return final_response.json()


def _send_usdc(recipient: str, amount_usdc: float) -> str:
    account = Account.from_key(PRIVATE_KEY)
    sender = account.address
    amount_wei = int(amount_usdc * 10**6)

    usdc = w3.eth.contract(
        address=Web3.to_checksum_address(USDC_CONTRACT),
        abi=[{
            "constant": False,
            "inputs": [
                {"name": "_to", "type": "address"},
                {"name": "_value", "type": "uint256"}
            ],
            "name": "transfer",
            "outputs": [{"name": "", "type": "bool"}],
            "type": "function"
        }]
    )

    tx = usdc.functions.transfer(
        Web3.to_checksum_address(recipient),
        amount_wei
    ).build_transaction({
        "from": sender,
        "nonce": w3.eth.get_transaction_count(sender),
        "gas": 120000,
        "gasPrice": w3.eth.gas_price,
    })

    signed_tx = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
    tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)
    w3.eth.wait_for_transaction_receipt(tx_hash)

    return tx_hash.hex()


if __name__ == "__main__":
    result = get_data_with_x402_payment()
    print(result)