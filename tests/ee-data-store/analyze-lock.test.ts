import { describe, it, expect } from 'vitest';
import { PgAnalyzeLock } from '@truecourse/ee-data-store';
import type { EeDbHandle } from '@truecourse/ee-db';

/**
 * The advisory lock's correctness is its connection lifecycle: acquire + unlock
 * must run on the SAME client, and the client must always be returned to the
 * pool. A real `pg_advisory_lock` needs a live Postgres session (PGlite is a
 * single in-process connection and can't model cross-connection blocking), so
 * we drive a fake pool that records every query and release.
 */

interface QueryCall {
  client: number;
  sql: string;
  params: unknown[];
}

function fakePool(opts: { failOn?: 'lock' | 'unlock' } = {}) {
  const queries: QueryCall[] = [];
  const released: number[] = [];
  const releaseArgs: unknown[] = []; // what was passed to client.release()
  let nextClient = 0;
  const pool = {
    connect: async () => {
      const id = nextClient++;
      return {
        query: async (sql: string, params: unknown[]) => {
          queries.push({ client: id, sql, params });
          if (opts.failOn === 'lock' && sql.includes('pg_advisory_lock(')) {
            throw new Error('boom');
          }
          if (opts.failOn === 'unlock' && sql.includes('pg_advisory_unlock(')) {
            throw new Error('unlock failed');
          }
          return {};
        },
        release: (arg?: unknown) => {
          released.push(id);
          releaseArgs.push(arg);
        },
      };
    },
  } as unknown as EeDbHandle['lockPool'];
  return { pool, queries, released, releaseArgs };
}

describe('PgAnalyzeLock', () => {
  it('acquires and releases on the same connection, then returns it to the pool', async () => {
    const { pool, queries, released } = fakePool();
    const lock = new PgAnalyzeLock(pool);

    await lock.acquire('acme/api');
    expect(queries).toEqual([
      { client: 0, sql: expect.stringContaining('pg_advisory_lock(hashtext($1))'), params: ['acme/api'] },
    ]);
    expect(released).toEqual([]); // still held — connection NOT returned

    await lock.release('acme/api');
    expect(queries[1]).toEqual({
      client: 0, // same connection that took the lock
      sql: expect.stringContaining('pg_advisory_unlock(hashtext($1))'),
      params: ['acme/api'],
    });
    expect(released).toEqual([0]); // connection returned exactly once
  });

  it('keeps a separate connection per key', async () => {
    const { pool, released } = fakePool();
    const lock = new PgAnalyzeLock(pool);

    await lock.acquire('a');
    await lock.acquire('b');
    await lock.release('a');
    expect(released).toEqual([0]); // only a's connection freed; b still held
    await lock.release('b');
    expect(released).toEqual([0, 1]);
  });

  it('release without a held lock is a no-op (does not touch the pool)', async () => {
    const { pool, queries, released } = fakePool();
    const lock = new PgAnalyzeLock(pool);
    await lock.release('never-acquired');
    expect(queries).toEqual([]);
    expect(released).toEqual([]);
  });

  it('returns the connection if the lock query itself fails', async () => {
    const { pool, released } = fakePool({ failOn: 'lock' });
    const lock = new PgAnalyzeLock(pool);
    await expect(lock.acquire('acme/api')).rejects.toThrow('boom');
    expect(released).toEqual([0]); // no leaked connection on failure
    // And a subsequent release is a no-op (it was never recorded as held).
    await lock.release('acme/api');
    expect(released).toEqual([0]);
  });

  it('refuses a re-entrant acquire of the same key (self-deadlock guard)', async () => {
    const { pool, released } = fakePool();
    const lock = new PgAnalyzeLock(pool);
    await lock.acquire('acme/api');
    // A second acquire on a different pooled connection would block forever on
    // the lock this process already holds — fail fast instead.
    await expect(lock.acquire('acme/api')).rejects.toThrow(/already held/);
    expect(released).toEqual([]); // the held connection is untouched
    await lock.release('acme/api');
    expect(released).toEqual([0]); // still releasable exactly once
  });

  it('destroys the connection (passes the error to release) when unlock fails', async () => {
    const { pool, released, releaseArgs } = fakePool({ failOn: 'unlock' });
    const lock = new PgAnalyzeLock(pool);
    await lock.acquire('acme/api');
    // release must not throw even though the unlock query does.
    await expect(lock.release('acme/api')).resolves.toBeUndefined();
    expect(released).toEqual([0]);
    // A suspect connection is destroyed, not returned clean: release got an Error.
    expect(releaseArgs[0]).toBeInstanceOf(Error);
  });
});
