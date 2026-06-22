// A real database password embedded directly in a connection string —
// exactly the credential leak the rule must catch. The password is a
// concrete secret value, not a documentation placeholder.
// VIOLATION: security/deterministic/hardcoded-database-password
export const DB_DSN = "postgresql://admin:S3cr3tDbKey9281@db.internal:5432/app";
