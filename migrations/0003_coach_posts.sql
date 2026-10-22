-- Posts the TuS Schnöselmob coach writes on /schnoeselmob/ (src/lib/coachPosts.ts); the scrape run builds them.
CREATE TABLE coach_posts (
  id INTEGER PRIMARY KEY,            -- 900001000 and up
  type TEXT NOT NULL,                -- 'lineup' | 'result' | 'player'
  data TEXT NOT NULL,                -- JSON CoachPostData
  published_at TEXT NOT NULL,        -- ISO, UTC
  pinned_until TEXT,
  image_id TEXT REFERENCES coach_images(id),
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
-- Photos for player news, shrunk in the coach's browser (JPEG, at most 600 KB).
CREATE TABLE coach_images (
  id TEXT PRIMARY KEY,               -- 16 hex chars
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  body BLOB NOT NULL,
  created_at TEXT NOT NULL
);
-- Wrong passwords, to slow down guessing (rows older than the window are cleared on each try).
CREATE TABLE coach_login (
  sender TEXT NOT NULL,              -- SHA-256 of the IP with a secret (ownComments.senderKey)
  at TEXT NOT NULL
);
CREATE INDEX coach_login_sender ON coach_login(sender, at);
