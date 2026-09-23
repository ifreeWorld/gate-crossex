CREATE TABLE spread_settings (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL);
CREATE TABLE spread_history (
  series_key TEXT NOT NULL, minute INTEGER NOT NULL, total REAL NOT NULL, samples INTEGER NOT NULL,
  PRIMARY KEY (series_key, minute)
);
CREATE INDEX spread_history_expiry ON spread_history(minute);
CREATE TABLE spread_episodes (direction_id TEXT PRIMARY KEY, notified INTEGER NOT NULL DEFAULT 0);
CREATE TABLE spread_notices (
  id INTEGER PRIMARY KEY AUTOINCREMENT, direction_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','sent','failed','unknown')), created_at TEXT NOT NULL
);
CREATE INDEX spread_notices_expiry ON spread_notices(created_at);
