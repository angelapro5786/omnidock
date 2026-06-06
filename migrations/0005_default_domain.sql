ALTER TABLE domains ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_domains_default
ON domains(is_default)
WHERE is_default = 1;
