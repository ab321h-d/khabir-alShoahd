-- خبير الشواهد: مخطط بيانات صغير وقابل للنقل (SQLite أو PostgreSQL).
-- طبّق القيود المتقدمة في طبقة الترحيل المناسبة لمزود قاعدة البيانات.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT UNIQUE,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE evidences (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  period TEXT NOT NULL,
  reflection TEXT,
  reflection_visible BOOLEAN NOT NULL DEFAULT TRUE,
  file_key TEXT,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE INDEX evidences_owner_updated_idx ON evidences(owner_id, updated_at DESC);

CREATE TABLE bundles (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  period TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);

CREATE TABLE bundle_items (
  bundle_id TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  evidence_id TEXT NOT NULL REFERENCES evidences(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (bundle_id, evidence_id),
  UNIQUE (bundle_id, position)
);

CREATE TABLE share_links (
  id TEXT PRIMARY KEY,
  bundle_id TEXT NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  recipient_label TEXT,
  access_mode TEXT NOT NULL CHECK (access_mode IN ('view', 'download')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL
);

CREATE INDEX share_links_bundle_idx ON share_links(bundle_id, expires_at);
