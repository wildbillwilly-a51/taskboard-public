CREATE TABLE offline_note_receipts (
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  note_id UUID NOT NULL,
  version INTEGER NOT NULL,
  PRIMARY KEY (owner_user_id, operation_id)
);
