CREATE TABLE spread_series (series_key TEXT PRIMARY KEY, started_at INTEGER NOT NULL);
INSERT INTO spread_series SELECT series_key, MIN(minute) FROM spread_history GROUP BY series_key;
ALTER TABLE spread_episodes ADD COLUMN amount_usd REAL NOT NULL DEFAULT 1000;
ALTER TABLE spread_episodes ADD COLUMN recovery_bps REAL;
UPDATE spread_episodes SET amount_usd = COALESCE((SELECT json_extract(payload, '$.amountUsd') FROM spread_settings WHERE id = 1), 1000);
