-- Comments on our own posts (content/posts/). LigaInsider's articles keep LigaInsider's comments.
CREATE TABLE comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id INTEGER NOT NULL,
  parent_id INTEGER REFERENCES comments(id),
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  -- SHA-256 of the sender's IP with a secret: only to limit how often one sender posts.
  sender TEXT
);
CREATE INDEX comments_post ON comments(post_id, created_at);
CREATE INDEX comments_sender ON comments(sender, created_at);
