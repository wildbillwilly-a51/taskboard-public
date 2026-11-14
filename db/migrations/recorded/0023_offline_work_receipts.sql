CREATE TABLE offline_work_receipts (
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  operation_id UUID NOT NULL,
  fingerprint TEXT NOT NULL,
  version TEXT NOT NULL,
  PRIMARY KEY (owner_user_id, operation_id)
);
