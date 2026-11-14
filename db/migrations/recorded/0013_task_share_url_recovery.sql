-- Existing hash-only publications remain valid and are never rotated by migration.
-- Only the authenticated publisher management path reads this encrypted value.
ALTER TABLE task_public_shares ADD COLUMN token_ciphertext TEXT;
