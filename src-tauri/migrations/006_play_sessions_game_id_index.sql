-- Migration 006 — index play_sessions by game_id.
--
-- The per-game playtime aggregation (`SELECT_GAMES`'s
-- `LEFT JOIN play_sessions s ON s.game_id = g.id`, used by list/get, the launch
-- monitor, and the detail modal) previously forced a full `play_sessions` scan.
-- This index lets the planner do an index search on the join instead.

CREATE INDEX idx_play_sessions_game_id ON play_sessions(game_id);
