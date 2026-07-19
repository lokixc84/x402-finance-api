from fastapi import FastAPI
import uvicorn
from data_fetcher import get_company_info
from data_processor import get_crypto_price
from x402_handler import x402_middleware

app = FastAPI(
    title="x402 Finance API",
    description="Real-time cryptocurrency price data protected by the x402 micropayment protocol",
    version="1.0.0"
)

app.middleware("http")(x402_middleware)


@app.get("/")
def home():
    return {
        "name": "x402 Finance API",
        "status": "live",
        "message": "Real-time crypto prices protected by x402 micropayments",
        "endpoints": {
            "/crypto/{symbol}": "Get real-time price (requires x402 payment of 0.01 USDC)",
            "/company/{ticker}": "Basic company info (legacy endpoint)"
        },
        "payment": {
            "amount": "0.01 USDC",
            "network": "base-sepolia",
            "header": "x-payment-tx"
        },
        "documentation": {
            "agent_guide": "See AGENT_GUIDE.md",
            "machine_index": "See llms.txt"
        }
    }


@app.get("/company/{ticker}")
def get_company(ticker: str):
    """Legacy company info endpoint"""
    return get_company_info(ticker)


@app.get("/crypto/{symbol}")
def get_crypto(symbol: str):
    """Get real-time crypto price (protected by x402)"""
    return get_crypto_price(symbol)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)