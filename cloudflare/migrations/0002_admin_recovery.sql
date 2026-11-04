CREATE TABLE IF NOT EXISTS admin_credentials (id INTEGER PRIMARY KEY CHECK(id=1), password_hash TEXT NOT NULL, base_version TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS admin_reset_tokens (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
