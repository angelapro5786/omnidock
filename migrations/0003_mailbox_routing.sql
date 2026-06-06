ALTER TABLE mailboxes ADD COLUMN routing_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mailboxes ADD COLUMN routing_rule_id TEXT;
