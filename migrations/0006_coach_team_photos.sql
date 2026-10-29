-- The coach's team photos (/schnoeselmob/): one photo per player, picked in the editor instead of uploading it
-- again for every post, and used by the hand-written own posts in content/posts/ (src/lib/teamPhotos.ts).
CREATE TABLE coach_team_photos (
  player TEXT PRIMARY KEY COLLATE NOCASE, -- the name as the coach writes it, "Luca Loibl" (one per name in any case)
  image_id TEXT NOT NULL,                 -- coach_images.id; removing the mapping keeps the image
  updated_at TEXT NOT NULL
);
