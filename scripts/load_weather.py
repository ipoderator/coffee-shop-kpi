#!/usr/bin/env python3
"""
Fetch historical weather for Lipetsk from Open-Meteo and upsert into analytics.weather_daily.
"""
import argparse
import datetime as dt
import logging
import sys
from typing import List, Tuple

import psycopg2
import psycopg2.extras
import requests

OPEN_METEO_URL = "https://archive-api.open-meteo.com/v1/era5"
LIPETSK_LAT = 52.61
LIPETSK_LON = 39.594

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)


def fetch_weather(start: dt.date, end: dt.date) -> dict:
    params = {
        "latitude": LIPETSK_LAT,
        "longitude": LIPETSK_LON,
        "start_date": start.isoformat(),
        "end_date": end.isoformat(),
        "daily": [
            "temperature_2m_max",
            "temperature_2m_min",
            "temperature_2m_mean",
            "precipitation_sum",
            "snowfall_sum",
            "windspeed_10m_max",
        ],
        "timezone": "Europe/Moscow",
    }
    logging.info("Requesting Open-Meteo archive %s", params)
    response = requests.get(OPEN_METEO_URL, params=params, timeout=30)
    response.raise_for_status()
    payload = response.json()
    return payload["daily"]


def build_rows(daily: dict) -> List[Tuple]:
    rows: List[Tuple] = []
    for idx, raw_date in enumerate(daily["time"]):
        rows.append(
            (
                dt.date.fromisoformat(raw_date),
                "Lipetsk,RU",
                to_number(daily["temperature_2m_min"][idx]),
                to_number(daily["temperature_2m_max"][idx]),
                to_number(daily["temperature_2m_mean"][idx]),
                to_number(daily["precipitation_sum"][idx]),
                to_number(daily["snowfall_sum"][idx]),
                to_number(daily["windspeed_10m_max"][idx]),
            )
        )
    return rows


def upsert_weather(conn, rows: List[Tuple]) -> None:
    if not rows:
        logging.info("No weather rows to upsert.")
        return

    with conn.cursor() as cur:
        psycopg2.extras.execute_values(
            cur,
            """
            INSERT INTO analytics.weather_daily (
                weather_date,
                location,
                temp_min_c,
                temp_max_c,
                temp_avg_c,
                precipitation_mm,
                snowfall_cm,
                wind_max_ms,
                created_at,
                updated_at
            )
            VALUES %s
            ON CONFLICT (weather_date) DO UPDATE
            SET
                location = EXCLUDED.location,
                temp_min_c = EXCLUDED.temp_min_c,
                temp_max_c = EXCLUDED.temp_max_c,
                temp_avg_c = EXCLUDED.temp_avg_c,
                precipitation_mm = EXCLUDED.precipitation_mm,
                snowfall_cm = EXCLUDED.snowfall_cm,
                wind_max_ms = EXCLUDED.wind_max_ms,
                updated_at = now();
            """,
            rows,
        )
    logging.info("Upserted %s weather rows", len(rows))


def to_number(value):
    if value is None:
        return None
    return round(float(value), 2)


def main():
    parser = argparse.ArgumentParser(description="Load Lipetsk weather archive.")
    parser.add_argument("--start", required=True, type=lambda s: dt.date.fromisoformat(s))
    parser.add_argument("--end", required=True, type=lambda s: dt.date.fromisoformat(s))
    parser.add_argument(
        "--dsn",
        default="host=localhost dbname=coffee_kpi user=postgres password=postgres",
        help="psycopg2 connection string",
    )
    args = parser.parse_args()

    if args.start > args.end:
        raise SystemExit("--start must be before or equal to --end")

    logging.info("Loading weather %s to %s", args.start, args.end)
    daily = fetch_weather(args.start, args.end)
    rows = build_rows(daily)

    with psycopg2.connect(args.dsn) as conn:
        upsert_weather(conn, rows)
        conn.commit()
    logging.info("Done.")


if __name__ == "__main__":
    main()
