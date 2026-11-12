CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  updated_at TEXT,
  data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE INDEX IF NOT EXISTS resources_source_date ON resources(source, updated_at DESC);
CREATE TABLE IF NOT EXISTS resource_status (
  source TEXT PRIMARY KEY,
  data TEXT NOT NULL CHECK(json_valid(data))
);
