
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  alt TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS site (
  id TEXT NOT NULL DEFAULT 'site' PRIMARY KEY,
  background_color TEXT NOT NULL DEFAULT '#ffffff',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sidebar (
  id TEXT NOT NULL DEFAULT 'sidebar' PRIMARY KEY,
  top_image_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  categories TEXT NOT NULL DEFAULT '[]',
  links TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS homepage (
  id TEXT NOT NULL DEFAULT 'homepage' PRIMARY KEY,
  blocks TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pages (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  blocks TEXT NOT NULL DEFAULT '[]',
  seo_title TEXT,
  seo_description TEXT,
  seo_image_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  seo_no_index INTEGER NOT NULL DEFAULT 0,
  seo_canonical TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO site (id) VALUES ('site');
INSERT OR IGNORE INTO sidebar (id) VALUES ('sidebar');
INSERT OR IGNORE INTO homepage (id) VALUES ('homepage');
