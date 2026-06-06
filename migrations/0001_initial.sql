CREATE TABLE IF NOT EXISTS domains (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  zone_id TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  sending_enabled INTEGER NOT NULL DEFAULT 0,
  routing_enabled INTEGER NOT NULL DEFAULT 0,
  catch_all_enabled INTEGER NOT NULL DEFAULT 0,
  worker_rule_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mailboxes (
  id TEXT PRIMARY KEY,
  domain_id TEXT NOT NULL,
  address TEXT NOT NULL UNIQUE,
  local_part TEXT NOT NULL,
  display_name TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  mailbox TEXT NOT NULL,
  domain TEXT NOT NULL,
  from_address TEXT NOT NULL,
  from_name TEXT,
  to_json TEXT NOT NULL,
  cc_json TEXT NOT NULL DEFAULT '[]',
  bcc_json TEXT NOT NULL DEFAULT '[]',
  subject TEXT NOT NULL DEFAULT '',
  snippet TEXT NOT NULL DEFAULT '',
  text_body TEXT,
  html_body TEXT,
  message_id TEXT,
  in_reply_to TEXT,
  references_header TEXT,
  raw_r2_key TEXT,
  sent_status TEXT,
  sent_message_id TEXT,
  error TEXT,
  read_at TEXT,
  archived_at TEXT,
  received_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  disposition TEXT,
  content_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'admin',
  target TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_domains_domain ON domains(domain);
CREATE INDEX IF NOT EXISTS idx_mailboxes_domain ON mailboxes(domain_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_mailbox ON messages(mailbox, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_domain ON messages(domain, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_direction ON messages(direction, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_message_id ON messages(message_id);
