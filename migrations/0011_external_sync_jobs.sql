CREATE TABLE IF NOT EXISTS external_sync_jobs (
  account_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'complete', 'failed')),
  folders_json TEXT NOT NULL DEFAULT '[]',
  folder_index INTEGER NOT NULL DEFAULT 0,
  next_uid_exclusive INTEGER,
  imported INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  checked INTEGER NOT NULL DEFAULT 0,
  run_count INTEGER NOT NULL DEFAULT 0,
  has_more INTEGER NOT NULL DEFAULT 1,
  message TEXT,
  last_error TEXT,
  lease_until TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  FOREIGN KEY (account_id) REFERENCES external_accounts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_external_sync_jobs_status
ON external_sync_jobs(status, lease_until, updated_at);
