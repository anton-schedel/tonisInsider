-- Bot comment jobs of the coach's posts: the cron finishes the ones the page left pending (src/lib/coachBotJob.ts).
CREATE TABLE coach_bots (
  post_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,               -- 'pending' | 'done' | 'failed'
  tries INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
