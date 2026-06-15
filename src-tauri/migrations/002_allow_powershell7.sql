-- Migration 002 — allow 'powershell7' as an interpreter.
--
-- SQLite cannot widen a CHECK constraint in place, so rebuild the scripts table
-- with the new interpreter CHECKs and copy existing rows across. The runner
-- disables foreign_keys while applying migrations (see src/db/migrations.rs), so
-- dropping the old table does not cascade-delete dependent rows.

CREATE TABLE scripts_new (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'normal' CHECK(kind IN ('normal','utility','global')),
  priority INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 1 AND 10),

  -- PHASE columns: used ONLY by normal/global entries (3 lifecycle phases)
  before_launch_mode TEXT NOT NULL DEFAULT 'none' CHECK(before_launch_mode IN ('none','path','inline')),
  before_launch_path TEXT,
  before_launch_inline TEXT,
  before_launch_interpreter TEXT CHECK(before_launch_interpreter IN ('powershell','powershell7','batch')),
  after_launch_mode TEXT NOT NULL DEFAULT 'none' CHECK(after_launch_mode IN ('none','path','inline')),
  after_launch_path TEXT,
  after_launch_inline TEXT,
  after_launch_interpreter TEXT CHECK(after_launch_interpreter IN ('powershell','powershell7','batch')),
  on_exit_mode TEXT NOT NULL DEFAULT 'none' CHECK(on_exit_mode IN ('none','path','inline')),
  on_exit_path TEXT,
  on_exit_inline TEXT,
  on_exit_interpreter TEXT CHECK(on_exit_interpreter IN ('powershell','powershell7','batch')),

  -- SNIPPET columns: used ONLY by utility scripts (a single phase-less snippet/library)
  snippet_mode TEXT NOT NULL DEFAULT 'none' CHECK(snippet_mode IN ('none','path','inline')),
  snippet_path TEXT,
  snippet_inline TEXT,
  snippet_interpreter TEXT CHECK(snippet_interpreter IN ('powershell','powershell7','batch')),

  created_at TEXT NOT NULL,
  -- utilities have no phases; normal/global have no snippet
  CHECK (kind <> 'utility' OR (before_launch_mode='none' AND after_launch_mode='none' AND on_exit_mode='none')),
  CHECK (kind =  'utility' OR snippet_mode='none')
);

INSERT INTO scripts_new SELECT * FROM scripts;
DROP TABLE scripts;
ALTER TABLE scripts_new RENAME TO scripts;
