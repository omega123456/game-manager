-- Migration 007 — cached install state for games.
--
-- A game whose launch target is a filesystem path that no longer exists is kept
-- in the library but marked as not installed. `missing_reason` is NULL while the
-- game is installed (or its target cannot be checked, e.g. a URI) and records
-- why the target is missing otherwise. `last_seen_installed_at` is the RFC 3339
-- timestamp of the last check that found the target present.

ALTER TABLE games ADD COLUMN missing_reason TEXT CHECK (missing_reason IN ('file_missing', 'drive_missing'));
ALTER TABLE games ADD COLUMN last_seen_installed_at TEXT;
