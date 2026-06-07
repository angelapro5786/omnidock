CREATE TABLE IF NOT EXISTS bucket_text_index (
  id TEXT PRIMARY KEY,
  bucket_id TEXT NOT NULL,
  bucket_name TEXT NOT NULL,
  bucket_binding TEXT NOT NULL,
  object_key TEXT NOT NULL,
  object_name TEXT NOT NULL,
  object_size INTEGER NOT NULL DEFAULT 0,
  object_etag TEXT,
  object_content_type TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(bucket_id, object_key)
);

CREATE INDEX IF NOT EXISTS idx_bucket_text_index_bucket
ON bucket_text_index(bucket_id, object_key);

CREATE INDEX IF NOT EXISTS idx_bucket_text_index_normalized
ON bucket_text_index(normalized_text);
