CREATE TABLE IF NOT EXISTS external_accounts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  username TEXT,
  auth_type TEXT NOT NULL DEFAULT 'app_password',
  credential_secret_name TEXT,
  imap_host TEXT,
  imap_port INTEGER,
  imap_security TEXT NOT NULL DEFAULT 'ssl',
  smtp_host TEXT,
  smtp_port INTEGER,
  smtp_security TEXT NOT NULL DEFAULT 'starttls',
  inbound_enabled INTEGER NOT NULL DEFAULT 0,
  outbound_enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'needs_secret',
  last_checked_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_external_accounts_email ON external_accounts(email);
CREATE INDEX IF NOT EXISTS idx_external_accounts_provider ON external_accounts(provider);
