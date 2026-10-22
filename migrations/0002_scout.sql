-- The scout list: players someone follows without having them. owner is a hash of their Kickbase email or
-- LigaInsider username (never the name itself).
CREATE TABLE scout (
  owner TEXT NOT NULL,
  player_id INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (owner, player_id)
);
-- When they last looked at the list: news after that counts as new (the badge on the tab).
CREATE TABLE scout_seen (
  owner TEXT PRIMARY KEY,
  seen_at TEXT NOT NULL
);
