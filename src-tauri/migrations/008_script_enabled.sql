-- Migration 008 — per-script enabled flag.
--
-- Lets a global script be switched off from Settings without demoting it to
-- `normal`. Existing rows default to enabled. The launch resolver only honours
-- the flag for global scripts.

ALTER TABLE scripts ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));
