/**
 * Postgres implementation of core's `AnalyzeLock` using session-level
 * `pg_advisory_lock`. Unlike the file lock (a lockfile on a throwaway clone that
 * each run recreates), this serializes two analyses of the SAME repo even across
 * separate clones/processes: `acquire` BLOCKS until the advisory lock is free.
 *
 * The lock is session-scoped, so acquire + unlock must run on the SAME
 * connection — we hold a dedicated pool client for the lock's lifetime and
 * release it on unlock. The key is hashed to an advisory-lock id via Postgres
 * `hashtext` (a rare hash collision merely makes two unrelated repos serialize —
 * harmless).
 */

import type { Pool, PoolClient } from '@truecourse/ee-db';
import type { AnalyzeLock } from '@truecourse/core/lib/analyze-lock';

export class PgAnalyzeLock implements AnalyzeLock {
  /** Dedicated connection holding each active lock, keyed by lock key. */
  private readonly held = new Map<string, PoolClient>();

  constructor(private readonly pool: Pool) {}

  async acquire(key: string): Promise<void> {
    // Re-entrant acquire would be a self-deadlock: the second `pg_advisory_lock`
    // runs on a DIFFERENT pooled connection (a separate session), so it would
    // block forever waiting on the lock this same process already holds. Fail
    // fast instead — like the file lock, a key held by us is a caller bug.
    if (this.held.has(key)) {
      throw new Error(`analyze lock for ${key} is already held by this process`);
    }
    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
      this.held.set(key, client);
    } catch (err) {
      client.release();
      throw err;
    }
  }

  async release(key: string): Promise<void> {
    const client = this.held.get(key);
    if (!client) return; // not held (e.g. acquire failed) — nothing to do
    this.held.delete(key);
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
      client.release();
    } catch (err) {
      // The unlock query failed — likely a broken session. Destroy the
      // connection (don't return a suspect one to the pool); the advisory lock
      // is auto-released when the session ends, so the lock itself is freed.
      client.release(err as Error);
    }
  }
}
