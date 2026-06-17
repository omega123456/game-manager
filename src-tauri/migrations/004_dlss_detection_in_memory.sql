-- Migration 004 — drop the persisted DLSS detection cache.
--
-- DLSS DLL detection is now recomputed on every application launch and held in
-- memory for the session only (it is never persisted). The only durable
-- per-game DLSS datum is the user's optional install-folder override, so the
-- table is rebuilt to keep just `game_id` + `folder_override`. The detected
-- version/path columns and the scan timestamp are removed.
--
-- Foreign keys are disabled by the migration runner, so the create/copy/drop/
-- rename pattern is safe here.

CREATE TABLE game_dlss_state_new (
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  folder_override TEXT
);

INSERT INTO game_dlss_state_new (game_id, folder_override)
  SELECT game_id, folder_override FROM game_dlss_state;

DROP TABLE game_dlss_state;

ALTER TABLE game_dlss_state_new RENAME TO game_dlss_state;
