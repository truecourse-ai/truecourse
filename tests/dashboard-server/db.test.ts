/**
 * The server's db singleton is set at boot. Reading it before `initDb` must
 * throw rather than hand back an undefined handle that fails deep in a query.
 */

import { describe, it, expect } from 'vitest';
import { getDb, getDbHandle } from '../../apps/dashboard/server/src/db';

describe('db singleton', () => {
  it('throws when read before initDb', () => {
    expect(() => getDb()).toThrow(/initDb/);
    expect(() => getDbHandle()).toThrow(/initDb/);
  });
});
