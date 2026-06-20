-- Migration 005 — latest-per-game launch execution ledger.
--
-- Persists the latest retained script-execution pipeline per game. Historical
-- rows are cleaned up automatically by repository maintenance so only the most
-- recent run survives for each game.

CREATE TABLE launch_runs (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  play_session_id INTEGER REFERENCES play_sessions(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('active','completed','cancelled','incomplete')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  failure_count INTEGER NOT NULL DEFAULT 0 CHECK(failure_count >= 0)
);

CREATE INDEX idx_launch_runs_game_started_at
  ON launch_runs(game_id, started_at DESC, id DESC);

CREATE INDEX idx_launch_runs_play_session_id
  ON launch_runs(play_session_id)
  WHERE play_session_id IS NOT NULL;

CREATE TABLE launch_run_script_records (
  id INTEGER PRIMARY KEY,
  launch_run_id INTEGER NOT NULL REFERENCES launch_runs(id) ON DELETE CASCADE,
  script_id INTEGER REFERENCES scripts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  phase TEXT NOT NULL CHECK(phase IN ('before','after','on_exit')),
  provenance TEXT NOT NULL CHECK(provenance IN ('global','group','direct')),
  group_name TEXT,
  order_in_phase INTEGER NOT NULL CHECK(order_in_phase >= 1),
  priority INTEGER NOT NULL CHECK(priority >= 0),
  required_utility_names_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK(status IN ('pending','running','succeeded','failed','not_reached')),
  started_at TEXT,
  ended_at TEXT,
  details TEXT
);

CREATE INDEX idx_launch_run_script_records_run_phase_order
  ON launch_run_script_records(launch_run_id, phase, order_in_phase, id);
