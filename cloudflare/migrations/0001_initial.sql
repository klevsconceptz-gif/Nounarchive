CREATE TABLE IF NOT EXISTS articles (id TEXT PRIMARY KEY, source TEXT NOT NULL, published_at TEXT, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE INDEX IF NOT EXISTS articles_source_date ON articles(source, published_at DESC);
CREATE TABLE IF NOT EXISTS source_status (source TEXT PRIMARY KEY, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('draft','published')), published_at TEXT, updated_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)));
CREATE INDEX IF NOT EXISTS posts_status_date ON posts(status, published_at DESC);
CREATE TABLE IF NOT EXISTS admin_sessions (token_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, credential_version TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_expiry ON admin_sessions(expires);
CREATE TABLE IF NOT EXISTS login_attempts (ip_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL);
