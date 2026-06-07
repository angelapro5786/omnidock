CREATE TABLE IF NOT EXISTS bucket_index_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  bucket_index INTEGER NOT NULL DEFAULT 0,
  cursor TEXT,
  scanned INTEGER NOT NULL DEFAULT 0,
  indexed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  ocr_indexed INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  last_error TEXT,
  lease_until TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_bucket_index_jobs_status
ON bucket_index_jobs(status, lease_until, updated_at);
