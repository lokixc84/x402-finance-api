# data_processor.py
import requests
import os
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

_cache = {}
_CACHE_DURATION = 30  # seconds

COINGECKO_API_KEY = os.getenv("COINGECKO_API_KEY")


def get_crypto_price(symbol: str = "bitcoin"):
    """Fetch crypto price with 30s caching + stale fallback + secure header auth"""
    symbol = symbol.lower()
    now = datetime.now()

    # Check for valid cache
    if symbol in _cache:
        cached_time, cached_data = _cache[symbol]
        age = (now - cached_time).total_seconds()

        if age < _CACHE_DURATION:
            result = cached_data.copy()
            result["cached"] = True
            result["cache_age_seconds"] = round(age, 1)
            return result

        # Keep stale data for fallback
        stale_data = cached_data.copy()
    else:
        stale_data = None

    # Build request
    url = f"https://api.coingecko.com/api/v3/simple/price?ids={symbol}&vs_currencies=usd"
    headers = {"accept": "application/json"}

    if COINGECKO_API_KEY:
        headers["x-cg-demo-api-key"] = COINGECKO_API_KEY

    try:
        response = requests.get(url, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()

        price = data[symbol]["usd"]

        result = {
            "symbol": symbol.upper(),
            "price_usd": price,
            "timestamp": now.isoformat(),
            "source": "CoinGecko",
            "cached": False,
            "cache_age_seconds": 0
        }

        _cache[symbol] = (now, result.copy())
        return result

    except Exception as e:
        # Fallback to stale cache if available
        if stale_data:
            stale_data["cached"] = True
            stale_data["cache_age_seconds"] = round((now - cached_time).total_seconds(), 1)
            stale_data["note"] = "Serving stale data due to API error"
            return stale_data

        return {
            "error": f"Failed to fetch data: {str(e)}",
            "symbol": symbol.upper(),
            "cached": False,
            "cache_age_seconds": 0
        }