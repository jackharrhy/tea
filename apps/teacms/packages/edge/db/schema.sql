CREATE TABLE IF NOT EXISTS tea_entries (
  collection TEXT NOT NULL,
  slug TEXT NOT NULL,
  draft TEXT,
  published TEXT,
  revision INTEGER NOT NULL DEFAULT 0,
  published_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (collection, slug)
);

CREATE TABLE IF NOT EXISTS tea_media (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  alt TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
