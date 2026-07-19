# data_fetcher.py
import random
import json

# Fake data for now (we will connect to real public sources later)
def get_company_info(ticker: str):
    sample_data = {
        "ticker": ticker.upper(),
        "company_name": "Example Corp",
        "sector": "Technology",
        "latest_filing_date": "2026-07-10",
        "summary": "This company reported strong revenue growth in Q2 2026.",
        "price_estimate": random.randint(50, 300)  # temporary
    }
    return sample_data

# Test it
if __name__ == "__main__":
    result = get_company_info("AAPL")
    print(json.dumps(result, indent=2))