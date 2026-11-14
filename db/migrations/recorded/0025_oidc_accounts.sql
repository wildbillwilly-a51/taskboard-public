ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE users DROP CONSTRAINT users_auth_provider_check;
ALTER TABLE users ADD CONSTRAINT users_auth_provider_check
  CHECK (auth_provider IN ('local', 'authelia', 'oidc'));

ALTER TABLE users ADD COLUMN oidc_issuer TEXT;
ALTER TABLE users ADD COLUMN oidc_subject TEXT;
ALTER TABLE users ADD CONSTRAINT users_oidc_identity_check CHECK (
  (auth_provider = 'oidc' AND oidc_issuer IS NOT NULL AND oidc_subject IS NOT NULL
    AND local_password_hash IS NULL AND NOT is_reserved_local_admin)
  OR (auth_provider <> 'oidc' AND oidc_issuer IS NULL AND oidc_subject IS NULL)
);
CREATE UNIQUE INDEX users_oidc_identity_unique ON users (oidc_issuer, oidc_subject)
  WHERE auth_provider = 'oidc';
