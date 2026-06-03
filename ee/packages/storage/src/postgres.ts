/** Postgres `bytea` BlobStore — blobs in the ee-db `blobs` table. */

import { eq, sql } from 'drizzle-orm';
import { blobs, type EeDb } from '@truecourse/ee-db';
import type { BlobStore } from './types.js';

export class PostgresBlobStore implements BlobStore {
  constructor(private readonly db: EeDb) {}

  async put(key: string, bytes: Buffer, opts?: { contentType?: string }): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .insert(blobs)
      .values({ key, bytes, contentType: opts?.contentType ?? null, updatedAt: now })
      .onConflictDoUpdate({
        target: blobs.key,
        set: {
          bytes: sql`excluded.bytes`,
          contentType: sql`excluded.content_type`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }

  async get(key: string): Promise<Buffer | null> {
    const rows = await this.db
      .select({ bytes: blobs.bytes })
      .from(blobs)
      .where(eq(blobs.key, key))
      .limit(1);
    // Normalise driver output (node-postgres Buffer / pglite Uint8Array).
    return rows[0] ? Buffer.from(rows[0].bytes) : null;
  }

  async delete(key: string): Promise<void> {
    await this.db.delete(blobs).where(eq(blobs.key, key));
  }

  async exists(key: string): Promise<boolean> {
    const rows = await this.db
      .select({ key: blobs.key })
      .from(blobs)
      .where(eq(blobs.key, key))
      .limit(1);
    return rows.length > 0;
  }

  async list(prefix: string): Promise<string[]> {
    // `starts_with` (not LIKE) so a prefix containing `%`/`_` from a
    // percent-encoded repo key isn't interpreted as a wildcard.
    const rows = await this.db
      .select({ key: blobs.key })
      .from(blobs)
      .where(sql`starts_with(${blobs.key}, ${prefix})`);
    return rows.map((r) => r.key);
  }
}
