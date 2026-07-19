# data_processor.py
import requests
import json
from datetime import datetime

def get_crypto_price(symbol: str = "bitcoin"):
    """Fetch real-time price from CoinGecko (free public API)"""
    url = f"https://api.coingecko.com/api/v3/simple/price?ids={symbol}&vs_currencies=usd"
    
    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()
        
        price = data[symbol]["usd"]
        
        return {
            "symbol": symbol.upper(),
            "price_usd": price,
            "timestamp": datetime.now().isoformat(),
            "source": "CoinGecko"
        }
    except Exception as e:
        return {"error": str(e), "symbol": symbol.upper()}

# Test function
if __name__ == "__main__":
    result = get_crypto_price("bitcoin")
    print(json.dumps(result, indent=2))
    
    result2 = get_crypto_price("ethereum")
    print(json.dumps(result2, indent=2))