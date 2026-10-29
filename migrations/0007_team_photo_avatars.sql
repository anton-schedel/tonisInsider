-- A team photo's avatar: the player cut out on our crest, LigaInsider style (scripts/team-avatar.py, made offline and
-- uploaded as a coach image). Picked in the editor, it is the feed's round picture as it is; own posts show it as the
-- player's photo. A new photo for the player clears it (it was cut from the old one).
ALTER TABLE coach_team_photos ADD COLUMN avatar_id TEXT; -- coach_images.id, or NULL
