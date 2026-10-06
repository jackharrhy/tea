CREATE TABLE IF NOT EXISTS content_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  content_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS content_history_lookup ON content_history (kind, content_id, id DESC);
CREATE TABLE IF NOT EXISTS site_preferences (
  id TEXT PRIMARY KEY DEFAULT 'preferences',
  site_name TEXT NOT NULL DEFAULT 'Untitled site',
  canonical_origin TEXT NOT NULL DEFAULT 'http://localhost',
  description TEXT NOT NULL DEFAULT '',
  homepage_seo TEXT NOT NULL DEFAULT '{}'
);
INSERT OR IGNORE INTO site_preferences (id) VALUES ('preferences');
