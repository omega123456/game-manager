-- Migration 003 — DLSS detection cache.
--
-- Stores the per-game DLSS state: an optional user-set install-folder override
-- and the cached results of the last folder scan (detected DLL display versions
-- and absolute paths for SR / FG / RR, plus the scan timestamp). Preset values
-- are NOT stored here — they live in the NVIDIA driver DB and are read/written
-- live via NVAPI. The row is keyed by game id and cascade-deleted with the game.

CREATE TABLE game_dlss_state (
  game_id INTEGER PRIMARY KEY REFERENCES games(id) ON DELETE CASCADE,
  folder_override TEXT,
  detected_sr_version TEXT,
  detected_fg_version TEXT,
  detected_rr_version TEXT,
  detected_sr_path TEXT,
  detected_fg_path TEXT,
  detected_rr_path TEXT,
  last_scanned_at TEXT
);
