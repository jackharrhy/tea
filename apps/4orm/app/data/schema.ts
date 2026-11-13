// Core table definitions preserve the source SQLite column and ID contract.
export const schema = `
CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER NOT NULL,
  banner_enabled BOOLEAN DEFAULT '0' NOT NULL,
  banner_html TEXT DEFAULT '' NOT NULL,
  banner_css TEXT DEFAULT '' NOT NULL,
  PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER NOT NULL,
  username VARCHAR(32) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  content TEXT DEFAULT '' NOT NULL,
  content_format VARCHAR(20) DEFAULT 'html' NOT NULL,
  avatar_media_id INTEGER,
  custom_css TEXT DEFAULT '' NOT NULL,
  custom_html TEXT DEFAULT '' NOT NULL,
  layout VARCHAR(20) DEFAULT 'default' NOT NULL,
  guestbook_css TEXT DEFAULT '' NOT NULL,
  guestbook_html TEXT DEFAULT '' NOT NULL,
  counter_css TEXT DEFAULT '' NOT NULL,
  counter_html TEXT DEFAULT '' NOT NULL,
  in_webring BOOLEAN DEFAULT '0' NOT NULL,
  status_emoji VARCHAR(10) DEFAULT '' NOT NULL,
  status_text VARCHAR(140) DEFAULT '' NOT NULL,
  status_updated_at DATETIME,
  status_css TEXT DEFAULT '' NOT NULL,
  status_html TEXT DEFAULT '' NOT NULL,
  player_css TEXT DEFAULT '' NOT NULL,
  player_html TEXT DEFAULT '' NOT NULL,
  forum_signature TEXT DEFAULT '' NOT NULL,
  is_admin BOOLEAN DEFAULT '0' NOT NULL,
  has_accepted_trust BOOLEAN DEFAULT '0' NOT NULL,
  notifications_enabled BOOLEAN DEFAULT '1' NOT NULL,
  watch_all_threads BOOLEAN DEFAULT '0' NOT NULL,
  is_disabled BOOLEAN DEFAULT '0' NOT NULL,
  invited_by_user_id INTEGER,
  invite_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  UNIQUE (username),
  FOREIGN KEY(avatar_media_id) REFERENCES media (id) ON DELETE SET NULL,
  FOREIGN KEY(invited_by_user_id) REFERENCES users (id) ON DELETE SET NULL,
  FOREIGN KEY(invite_id) REFERENCES invites (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY(author_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS external_identities (
  issuer VARCHAR(255) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  user_id INTEGER NOT NULL,
  PRIMARY KEY (issuer, subject),
  FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS forum_threads (
  id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  title VARCHAR(200) NOT NULL,
  custom_css TEXT DEFAULT '' NOT NULL,
  custom_html TEXT DEFAULT '' NOT NULL,
  is_pinned BOOLEAN DEFAULT '0' NOT NULL,
  is_locked BOOLEAN DEFAULT '0' NOT NULL,
  reply_count INTEGER DEFAULT '0' NOT NULL,
  last_reply_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_reply_by_id INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY(author_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY(last_reply_by_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS guestbook_entries (
  id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY(author_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS invites (
  id INTEGER NOT NULL,
  code VARCHAR(64) NOT NULL,
  created_by_user_id INTEGER NOT NULL,
  used_by_user_id INTEGER,
  max_uses INTEGER DEFAULT '1' NOT NULL,
  uses_count INTEGER DEFAULT '0' NOT NULL,
  expires_at DATETIME,
  disabled BOOLEAN DEFAULT '0' NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  used_at DATETIME,
  PRIMARY KEY (id),
  CONSTRAINT ck_invites_max_uses CHECK (max_uses >= 1),
  UNIQUE (code),
  FOREIGN KEY(created_by_user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY(used_by_user_id) REFERENCES users (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  storage_path VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  width INTEGER,
  height INTEGER,
  size_bytes INTEGER DEFAULT '0' NOT NULL,
  alt_text VARCHAR(255) DEFAULT '' NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  slug VARCHAR(80) NOT NULL,
  title VARCHAR(140) NOT NULL,
  content TEXT DEFAULT '' NOT NULL,
  content_format VARCHAR(20) DEFAULT 'html' NOT NULL,
  layout VARCHAR(20) DEFAULT 'default' NOT NULL,
  is_public BOOLEAN DEFAULT '1' NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_pages_user_slug UNIQUE (user_id, slug),
  FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS profile_cards (
  user_id INTEGER NOT NULL,
  headline VARCHAR(120) DEFAULT '' NOT NULL,
  content TEXT DEFAULT '' NOT NULL,
  content_format VARCHAR(20) DEFAULT 'html' NOT NULL,
  accent_color VARCHAR(20) DEFAULT '#00ffff' NOT NULL,
  border_style VARCHAR(20) DEFAULT 'outset' NOT NULL,
  card_css TEXT DEFAULT '' NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (user_id),
  FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  device_id VARCHAR(64) NOT NULL,
  device_name VARCHAR(100) DEFAULT '' NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh_key TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_push_user_device UNIQUE (user_id, device_id),
  FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS visitor_counters (
  user_id INTEGER NOT NULL,
  total_views INTEGER DEFAULT '0' NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (user_id),
  FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS auth_enrollments (
  id VARCHAR(64) NOT NULL,
  invite_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  subject VARCHAR(255),
  username VARCHAR(32),
  display_name VARCHAR(80),
  user_id INTEGER,
  consumed_at INTEGER,
  PRIMARY KEY (id),
  FOREIGN KEY(invite_id) REFERENCES invites (id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS forum_posts (
  id INTEGER NOT NULL,
  thread_id INTEGER NOT NULL,
  author_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  content_format VARCHAR(20) DEFAULT 'bbcode' NOT NULL,
  quoted_post_id INTEGER,
  quoted_content TEXT,
  quoted_content_format VARCHAR(20),
  quoted_author VARCHAR(80),
  is_edited BOOLEAN DEFAULT '0' NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  FOREIGN KEY(thread_id) REFERENCES forum_threads (id) ON DELETE CASCADE,
  FOREIGN KEY(author_id) REFERENCES users (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS playlist_items (
  id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  media_id INTEGER NOT NULL,
  position INTEGER DEFAULT '0' NOT NULL,
  title VARCHAR(200),
  PRIMARY KEY (id),
  FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY(media_id) REFERENCES media (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS thread_watchers (
  id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  thread_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT uq_thread_watchers UNIQUE (user_id, thread_id),
  FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE,
  FOREIGN KEY(thread_id) REFERENCES forum_threads (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS enrollment_completions (
  request_id VARCHAR(64) NOT NULL,
  issuer VARCHAR(255) NOT NULL,
  delivered_at INTEGER,
  last_status INTEGER,
  PRIMARY KEY (request_id),
  FOREIGN KEY(request_id) REFERENCES auth_enrollments (id)
);

CREATE TABLE IF NOT EXISTS enrollment_grants (
  request_id VARCHAR(64) NOT NULL,
  application_id VARCHAR(16) NOT NULL,
  attempt_id VARCHAR(128) NOT NULL,
  grant_id VARCHAR(255),
  outcome VARCHAR(16),
  PRIMARY KEY (request_id, application_id),
  CHECK (application_id IN ('maps', 'burger')),
  CHECK (outcome IS NULL OR outcome IN ('created', 'preserved')),
  FOREIGN KEY(request_id) REFERENCES enrollment_completions (request_id)
);`;

export const coreTables = Array.from(
  schema.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g),
  ([, name]) => name,
);
