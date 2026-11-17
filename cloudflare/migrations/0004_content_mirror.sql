CREATE TABLE IF NOT EXISTS mirror_crawl_queue (
  source TEXT NOT NULL,
  url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('sitemap','page','asset')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done','error')),
  attempts INTEGER NOT NULL DEFAULT 0,
  source_updated_at TEXT,
  parent_url TEXT,
  last_error TEXT,
  discovered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(source,url,kind)
);
CREATE INDEX IF NOT EXISTS mirror_queue_work ON mirror_crawl_queue(kind,state,source,discovered_at);
CREATE TABLE IF NOT EXISTS mirror_documents (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  content_text TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL DEFAULT 'text/html',
  source_published_at TEXT,
  source_modified_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata)),
  UNIQUE(source,canonical_url)
);
CREATE INDEX IF NOT EXISTS mirror_documents_source_date ON mirror_documents(source,last_seen_at DESC);
CREATE INDEX IF NOT EXISTS mirror_documents_title ON mirror_documents(title);
CREATE TABLE IF NOT EXISTS mirror_assets (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  source TEXT NOT NULL,
  source_url TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER,
  etag TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(metadata)),
  UNIQUE(source,source_url)
);
CREATE INDEX IF NOT EXISTS mirror_assets_document ON mirror_assets(document_id);
CREATE TABLE IF NOT EXISTS mirror_crawl_state (
  source TEXT PRIMARY KEY,
  last_discovery_at TEXT,
  last_crawl_at TEXT,
  pending_pages INTEGER NOT NULL DEFAULT 0,
  pending_assets INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);
CREATE TABLE IF NOT EXISTS private_student_result_batches (
  id TEXT PRIMARY KEY,
  source_format TEXT NOT NULL CHECK(source_format IN ('csv','json')),
  total_records INTEGER NOT NULL,
  imported_records INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS private_student_results (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES private_student_result_batches(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(batch_id,row_index)
);
CREATE INDEX IF NOT EXISTS private_results_batch ON private_student_results(batch_id,row_index);
