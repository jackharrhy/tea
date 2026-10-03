CREATE TABLE IF NOT EXISTS adornments (
 id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
 media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
 css TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
ALTER TABLE site_preferences ADD COLUMN analytics_id TEXT NOT NULL DEFAULT '';
ALTER TABLE site_preferences ADD COLUMN analytics_enabled INTEGER NOT NULL DEFAULT 0;
