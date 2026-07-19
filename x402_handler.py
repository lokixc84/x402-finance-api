# x402_handler.py
from fastapi import Request
from fastapi.responses import JSONResponse
import os
from dotenv import load_dotenv
from web3 import Web3

load_dotenv()

WALLET_ADDRESS = os.getenv("WALLET_ADDRESS")
BASE_SEPOLIA_RPC = "https://sepolia.base.org"
USDC_CONTRACT = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"  # Official Base Sepolia USDC

w3 = Web3(Web3.HTTPProvider(BASE_SEPOLIA_RPC))

# ERC-20 Transfer event signature
TRANSFER_EVENT_SIGNATURE = w3.keccak(text="Transfer(address,address,uint256)").hex()

# Exact amount required: 0.01 USDC (6 decimals = 10000)
REQUIRED_AMOUNT = 10000

async def x402_middleware(request: Request, call_next):
    if request.url.path.startswith("/crypto/"):
        payment_tx = request.headers.get("x-payment-tx")

        if not payment_tx:
            return JSONResponse(
                status_code=402,
                content={
                    "title": "Payment Required",
                    "status": 402,
                    "detail": "Payment via x402 required",
                    "payment": {
                        "amount": "0.01",
                        "asset": "USDC",
                        "network": "base-sepolia",
                        "to": WALLET_ADDRESS,
                        "description": "Real-time crypto price data"
                    }
                }
            )

        try:
            receipt = w3.eth.get_transaction_receipt(payment_tx)

            if not receipt or receipt.status != 1:
                return JSONResponse(status_code=403, content={"error": "Transaction failed or not found"})

            # Reject old transactions (within ~20-30 minutes)
            current_block = w3.eth.block_number
            if current_block - receipt.blockNumber > 100:
                return JSONResponse(status_code=403, content={"error": "Transaction too old"})

            # Check for exact USDC transfer to our wallet
            valid_payment = False
            for log in receipt.logs:
                if log.address.lower() == USDC_CONTRACT.lower():
                    if log.topics[0].hex() == TRANSFER_EVENT_SIGNATURE:
                        to_address = "0x" + log.topics[2].hex()[-40:]
                        amount = int.from_bytes(log.data, "big")

                        # STRICT: Must be exactly 0.01 USDC to our wallet
                        if (to_address.lower() == WALLET_ADDRESS.lower() and 
                            amount == REQUIRED_AMOUNT):
                            valid_payment = True
                            break

            if not valid_payment:
                return JSONResponse(
                    status_code=403, 
                    content={"error": "Invalid payment - must send exactly 0.01 USDC to this wallet"}
                )

        except Exception as e:
            return JSONResponse(status_code=403, content={"error": f"Payment verification failed"})

    response = await call_next(request)
    return response