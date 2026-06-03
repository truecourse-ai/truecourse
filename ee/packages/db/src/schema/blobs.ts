/**
 * Content blob table, backing the `postgres` BlobStore adapter (the
 * minimal, object-store-free deploy). Holds bulky artifacts — contract
 * corpora, spec/analysis snapshots, caches — as `bytea`, keyed by an opaque
 * content-addressed / repo-scoped key.
 */

import { pgTable, text, timestamp, customType } from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/** Postgres `bytea` ⇄ Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const blobs = pgTable('blobs', {
  key: text('key').primaryKey(),
  bytes: bytea('bytes').notNull(),
  contentType: text('content_type'),
  updatedAt: ts('updated_at').notNull(),
});
