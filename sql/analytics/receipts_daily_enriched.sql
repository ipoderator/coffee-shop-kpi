CREATE OR REPLACE VIEW analytics.receipts_daily_enriched AS
SELECT
    r.receipt_date,
    r.store_id,
    r.gross_sales,
    r.net_sales,
    r.orders_count,
    w.temp_min_c,
    w.temp_max_c,
    w.temp_avg_c,
    w.precipitation_mm,
    w.snowfall_cm,
    w.wind_max_ms,
    c.is_weekend,
    c.is_holiday,
    c.week_of_year,
    c.month_of_year
FROM analytics.receipts_daily AS r
LEFT JOIN analytics.weather_daily AS w
    ON w.weather_date = r.receipt_date
LEFT JOIN analytics.calendar AS c
    ON c.calendar_date = r.receipt_date;
