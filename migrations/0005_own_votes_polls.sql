-- Upvotes and polls under our own posts (src/lib/ownVotes.ts). Bot votes are stored as full numbers and shown
-- growing over 30 minutes after the comment appears.
ALTER TABLE comments ADD COLUMN bot_upvotes INTEGER NOT NULL DEFAULT 0;
CREATE TABLE comment_votes (
  comment_id INTEGER NOT NULL,
  voter TEXT NOT NULL,                 -- random id from the visitor's "ov" cookie
  PRIMARY KEY (comment_id, voter)
);
CREATE TABLE polls (
  comment_id INTEGER PRIMARY KEY,
  question TEXT NOT NULL
);
CREATE TABLE poll_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id INTEGER NOT NULL,
  position INTEGER NOT NULL,
  label TEXT NOT NULL,
  bot_votes INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX poll_options_comment ON poll_options(comment_id, position);
CREATE TABLE poll_votes (
  comment_id INTEGER NOT NULL,
  voter TEXT NOT NULL,
  option_id INTEGER NOT NULL,
  PRIMARY KEY (comment_id, voter)
);
