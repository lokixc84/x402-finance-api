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
    """Fetch price with caching, stale fallback, and defensive error handling"""
    symbol = symbol.lower().strip()
    now = datetime.now()

    # Check cache
    if symbol in _cache:
        cached_time, cached_data = _cache[symbol]
        age = (now - cached_time).total_seconds()

        if age < _CACHE_DURATION:
            result = cached_data.copy()
            result["cached"] = True
            result["cache_age_seconds"] = round(age, 1)
            return result

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

        # === DEFENSIVE CHECK ===
        if not data or symbol not in data or "usd" not in data[symbol]:
            # Invalid symbol or empty response from CoinGecko
            if stale_data:
                stale_data["cached"] = True
                stale_data["cache_age_seconds"] = round((now - cached_time).total_seconds(), 1)
                stale_data["note"] = "Serving stale data - invalid or unsupported symbol"
                return stale_data

            return {
                "error": f"Symbol '{symbol}' not found or no price data available",
                "symbol": symbol.upper(),
                "cached": False,
                "cache_age_seconds": 0
            }

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