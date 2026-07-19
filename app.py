from fastapi import FastAPI
import uvicorn
from data_fetcher import get_company_info
from data_processor import get_crypto_price
from x402_handler import x402_middleware

app = FastAPI(title="Team Grok + Human x402 Finance API")

app.middleware("http")(x402_middleware)

@app.get("/")
def home():
    return {"message": "API Live - /crypto/{symbol} is protected with x402"}

@app.get("/company/{ticker}")
def get_company(ticker: str):
    return get_company_info(ticker)

@app.get("/crypto/{symbol}")
def get_crypto(symbol: str = "bitcoin"):
    return get_crypto_price(symbol.lower())

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)