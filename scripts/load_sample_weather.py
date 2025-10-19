#!/usr/bin/env python3
"""
Load sample weather data for demonstration purposes.
This script loads weather data for the last 3 months to demonstrate the forecasting system.
"""
import datetime as dt
import logging
import sys
import subprocess

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

def main():
    # Calculate date range for last 3 months
    end_date = dt.date.today()
    start_date = end_date - dt.timedelta(days=90)
    
    logging.info(f"Loading weather data from {start_date} to {end_date}")
    
    # Run the weather loading script
    cmd = [
        "python3", 
        "scripts/load_weather.py",
        "--start", start_date.isoformat(),
        "--end", end_date.isoformat()
    ]
    
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        logging.info("Weather data loaded successfully")
        logging.info(result.stdout)
    except subprocess.CalledProcessError as e:
        logging.error(f"Failed to load weather data: {e}")
        logging.error(e.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
