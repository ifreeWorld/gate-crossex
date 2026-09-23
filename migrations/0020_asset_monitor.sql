CREATE TABLE observation_settings (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL);
CREATE TABLE observation_history (
  market_id TEXT NOT NULL, minute INTEGER NOT NULL, cycle INTEGER NOT NULL,
  observed_at INTEGER NOT NULL, mid TEXT NOT NULL,
  PRIMARY KEY (market_id, minute)
);
CREATE INDEX observation_history_time ON observation_history(minute);
CREATE TABLE observation_episodes (direction_id TEXT PRIMARY KEY, alerted INTEGER NOT NULL DEFAULT 0);
CREATE TABLE observation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, direction_id TEXT NOT NULL, message TEXT NOT NULL,
  created_at INTEGER NOT NULL, status TEXT NOT NULL
);
