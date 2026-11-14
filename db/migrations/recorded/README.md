# Database migrations

The public edition initializes a fresh PostgreSQL database from
`db/baseline/schema.sql` and `src/lib/schema-baseline.ts`. The
`schema_migrations` ledger records the `public_baseline` marker and each
subsequent migration with a checksum.

Keep the baseline and applied migrations fixed. Add new SQL under
`db/migrations/recorded/` using the next unused four-digit number. Preserve
existing filenames and gaps. The runner applies each file in its own transaction.

This lineage starts with the public edition. Use a new database for first setup
and keep the database and uploads volume together when backing up an install.
