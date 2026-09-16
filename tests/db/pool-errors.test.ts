/**
 * A dropped Postgres connection must reach the handler, never an unhandled
 * `error` event. pg-pool only listens on a client while it is idle, so the
 * checked-out case (a backend dying mid-transaction) is the one that used to
 * crash the process. A fake client class stands in for the socket: pg-pool
 * accepts it through its `Client` option.
 */
import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { Pool, watchClientErrors } from '@truecourse/db';

class FakeClient extends EventEmitter {
  connect(cb: (err?: Error) => void) {
    cb();
  }
  end(cb?: () => void) {
    cb?.();
  }
  isConnected() {
    return true;
  }
}

function poolWithHandler() {
  const errors: Array<{ message: string; pool: string }> = [];
  const pool = new Pool({ Client: FakeClient as never });
  watchClientErrors(pool, 'main', (err, name) => errors.push({ message: err.message, pool: name }));
  return { pool, errors };
}

describe('watchClientErrors', () => {
  it('reports a checked-out client error instead of throwing', async () => {
    const { pool, errors } = poolWithHandler();
    const client = await pool.connect();
    expect(() => client.emit('error', new Error('server closed the connection unexpectedly'))).not.toThrow();
    expect(errors).toEqual([{ message: 'server closed the connection unexpectedly', pool: 'main' }]);
    client.release(new Error('discard'));
    await pool.end();
  });

  it('reports an idle client error exactly once', async () => {
    const { pool, errors } = poolWithHandler();
    const client = await pool.connect();
    client.release();
    expect(() => client.emit('error', new Error('idle drop'))).not.toThrow();
    expect(errors).toEqual([{ message: 'idle drop', pool: 'main' }]);
    await pool.end();
  });
});
