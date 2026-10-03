CREATE TABLE IF NOT EXISTS page_drafts (
  slug TEXT PRIMARY KEY,
  snapshot TEXT NOT NULL,
  revision TEXT NOT NULL,
  published_revision TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS media_folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  parent_id TEXT REFERENCES media_folders(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX IF NOT EXISTS media_folder_names ON media_folders(COALESCE(parent_id, ''), name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS media_details (
  media_id TEXT PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  folder_id TEXT REFERENCES media_folders(id) ON DELETE RESTRICT,
  description TEXT NOT NULL DEFAULT ''
);
