CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.weather_daily (
    weather_date      date PRIMARY KEY,
    location          text NOT NULL DEFAULT 'Lipetsk,RU',
    temp_min_c        numeric(5, 2),
    temp_max_c        numeric(5, 2),
    temp_avg_c        numeric(5, 2),
    precipitation_mm  numeric(6, 2),
    snowfall_cm       numeric(6, 2),
    wind_max_ms       numeric(6, 2),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE analytics.weather_daily IS 'Daily aggregated weather metrics for Lipetsk from Open-Meteo archive.';

CREATE INDEX IF NOT EXISTS weather_daily_date_idx ON analytics.weather_daily (weather_date);
