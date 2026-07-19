# data_processor.py
import requests
import json
from datetime import datetime, timedelta

# Simple in-memory cache
_cache = {}
_CACHE_DURATION = 30  # seconds

def get_crypto_price(symbol: str = "bitcoin"):
    """Fetch real-time price with 30-second caching"""
    symbol = symbol.lower()
    now = datetime.now()

    # Check if we have a valid cached value
    if symbol in _cache:
        cached_time, cached_data = _cache[symbol]
        if now - cached_time < timedelta(seconds=_CACHE_DURATION):
            cached_data["cached"] = True
            return cached_data

    # Cache expired or not found → fetch fresh data
    url = f"https://api.coingecko.com/api/v3/simple/price?ids={symbol}&vs_currencies=usd"

    try:
        response = requests.get(url, timeout=10)
        response.raise_for_status()
        data = response.json()

        price = data[symbol]["usd"]

        result = {
            "symbol": symbol.upper(),
            "price_usd": price,
            "timestamp": now.isoformat(),
            "source": "CoinGecko",
            "cached": False
        }

        # Update cache
        _cache[symbol] = (now, result)
        return result

    except Exception as e:
        return {"error": str(e), "symbol": symbol.upper()}