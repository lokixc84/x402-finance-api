# data_processor.py
import requests
from datetime import datetime, timedelta

# In-memory cache
_cache = {}
_CACHE_DURATION = 30  # seconds

def get_crypto_price(symbol: str = "bitcoin"):
    """Get crypto price with 30-second caching and cache age tracking"""
    symbol = symbol.lower()
    now = datetime.now()

    # Check if we have valid cached data
    if symbol in _cache:
        cached_time, cached_data = _cache[symbol]
        age_seconds = (now - cached_time).total_seconds()

        if age_seconds < _CACHE_DURATION:
            # Serve from cache
            result = cached_data.copy()
            result["cached"] = True
            result["cache_age_seconds"] = round(age_seconds, 1)
            return result

    # Cache miss or expired → fetch fresh data from CoinGecko
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
            "cached": False,
            "cache_age_seconds": 0
        }

        # Store in cache
        _cache[symbol] = (now, result.copy())
        return result

    except Exception as e:
        return {
            "error": str(e),
            "symbol": symbol.upper(),
            "cached": False,
            "cache_age_seconds": 0
        }