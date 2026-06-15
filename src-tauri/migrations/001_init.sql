-- Migration 001 — initial schema.
--
-- Authoritative SQLite schema for Game Manager. Compiled into the binary via
-- include_str! and registered in the MIGRATIONS array (src/db/migrations.rs).
-- The connection is opened with:
--   PRAGMA journal_mode = WAL;
--   PRAGMA foreign_keys = ON;
--   PRAGMA auto_vacuum = INCREMENTAL;

CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  launch_target TEXT NOT NULL,
  monitor_mode TEXT NOT NULL DEFAULT 'tree' CHECK(monitor_mode IN ('tree','named')),
  monitor_process_name TEXT,
  arguments TEXT,
  image_path TEXT,
  created_at TEXT NOT NULL,
  CHECK (monitor_mode <> 'named' OR (monitor_process_name IS NOT NULL AND monitor_process_name <> ''))
);

CREATE TABLE scripts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'normal' CHECK(kind IN ('normal','utility','global')),
  priority INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 1 AND 10),

  -- PHASE columns: used ONLY by normal/global entries (3 lifecycle phases)
  before_launch_mode TEXT NOT NULL DEFAULT 'none' CHECK(before_launch_mode IN ('none','path','inline')),
  before_launch_path TEXT,
  before_launch_inline TEXT,
  before_launch_interpreter TEXT CHECK(before_launch_interpreter IN ('powershell','batch')),
  after_launch_mode TEXT NOT NULL DEFAULT 'none' CHECK(after_launch_mode IN ('none','path','inline')),
  after_launch_path TEXT,
  after_launch_inline TEXT,
  after_launch_interpreter TEXT CHECK(after_launch_interpreter IN ('powershell','batch')),
  on_exit_mode TEXT NOT NULL DEFAULT 'none' CHECK(on_exit_mode IN ('none','path','inline')),
  on_exit_path TEXT,
  on_exit_inline TEXT,
  on_exit_interpreter TEXT CHECK(on_exit_interpreter IN ('powershell','batch')),

  -- SNIPPET columns: used ONLY by utility scripts (a single phase-less snippet/library)
  snippet_mode TEXT NOT NULL DEFAULT 'none' CHECK(snippet_mode IN ('none','path','inline')),
  snippet_path TEXT,
  snippet_inline TEXT,
  snippet_interpreter TEXT CHECK(snippet_interpreter IN ('powershell','batch')),

  created_at TEXT NOT NULL,
  -- utilities have no phases; normal/global have no snippet
  CHECK (kind <> 'utility' OR (before_launch_mode='none' AND after_launch_mode='none' AND on_exit_mode='none')),
  CHECK (kind =  'utility' OR snippet_mode='none')
);

CREATE TABLE script_dependencies (
  script_id INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  depends_on_script_id INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  PRIMARY KEY (script_id, depends_on_script_id)
);

CREATE TABLE groups (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT
);

CREATE TABLE game_groups (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  PRIMARY KEY (game_id, group_id)
);

CREATE TABLE game_scripts (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  script_id INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  PRIMARY KEY (game_id, script_id)
);

CREATE TABLE group_scripts (
  group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  script_id INTEGER NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
  PRIMARY KEY (group_id, script_id)
);

CREATE TABLE play_sessions (
  id INTEGER PRIMARY KEY,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE logs (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  level TEXT NOT NULL CHECK(level IN ('debug','info','warn','error')),
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  game_id INTEGER REFERENCES games(id) ON DELETE SET NULL,
  script_id INTEGER REFERENCES scripts(id) ON DELETE SET NULL,
  details TEXT
);

CREATE INDEX idx_logs_ts ON logs(ts);
