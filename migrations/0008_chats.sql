-- "Deine Chats" (src/lib/chatsDb.ts): the conversations someone wrote in through TonInsider, per LigaInsider
-- account (an HMAC of the username, never the name). A conversation is a thread's top-level comment and
-- everything under it.
CREATE TABLE chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  thread TEXT NOT NULL,        -- thread key: LigaInsider article id, "t…" lineup page, or our own post's id
  root INTEGER NOT NULL,       -- the conversation's top-level comment
  mine TEXT NOT NULL,          -- JSON: ids of what you wrote in it
  started INTEGER NOT NULL,    -- 1 when the top comment is yours
  kind TEXT NOT NULL,          -- your last write: comment | poll | answer
  text TEXT NOT NULL,          -- its start (an Umfrage: the question)
  place TEXT NOT NULL,         -- JSON: the article's title, link and club
  wrote_at TEXT NOT NULL,
  activity_at TEXT NOT NULL,   -- your last write or the newest answer, as last known
  state TEXT,                  -- JSON: where it stood at the last read
  seen TEXT,                   -- JSON: where it stood when you last looked
  checked_at TEXT,
  UNIQUE (account, thread, root)
);
CREATE INDEX chats_account ON chats(account, wrote_at);
