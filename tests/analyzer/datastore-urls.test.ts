/**
 * DATASTORE CONNECTION URLS HARVESTED FROM SOURCE (item 68).
 *
 * The same walk and the same env-association rules item 63 built for third-party
 * base URLs, over the datastore schemes. The motivating shape is `speced-api`'s
 * config module — `DATABASE_URL: 'postgres://localhost:5432/weather'` inside a
 * defaults map — because that one literal is everything a generated container
 * needs: the engine, the port, the database, and the variable that overrides it.
 */

import { describe, it, expect } from 'vitest';
import { parseCode } from '../../packages/analyzer/src/parser';
import { extractExternalHttp } from '../../packages/analyzer/src/extractors/external-http';
import { collectDatastoreUrls } from '../../packages/analyzer/src/datastore-endpoints';
import type { CallExpression, FileAnalysis } from '../../packages/shared/src/types/analysis';

function extract(code: string, filePath = '/repo/src/config.ts') {
  return extractExternalHttp(parseCode(code, 'typescript'), filePath, 'typescript');
}

function analyzed(filePath: string, code: string): FileAnalysis {
  const { refs, urlEnvReads, datastoreRefs } = extract(code, filePath);
  return {
    filePath,
    language: 'typescript',
    functions: [],
    classes: [],
    imports: [],
    exports: [],
    calls: [] as CallExpression[],
    httpCalls: [],
    ...(refs.length > 0 ? { externalHttpRefs: refs } : {}),
    ...(urlEnvReads.length > 0 ? { urlEnvReads } : {}),
    ...(datastoreRefs.length > 0 ? { datastoreUrlRefs: datastoreRefs } : {}),
  };
}

describe('datastore URL harvest', () => {
  it('binds the defaults-map key to the connection URL (the speced-api shape)', () => {
    const { datastoreRefs } = extract(`
      const DEFAULTS = {
        PORT: 8080,
        GEOCODING_BASE_URL: 'https://geocoding-api.open-meteo.com',
        DATABASE_URL: 'postgres://localhost:5432/weather',
      } as const;
      function read(env: NodeJS.ProcessEnv, name: string, fallback: string) {
        return env[name] ?? fallback;
      }
    `);

    expect(datastoreRefs).toHaveLength(1);
    expect(datastoreRefs[0]).toMatchObject({
      url: 'postgres://localhost:5432/weather',
      scheme: 'postgres',
      envVar: 'DATABASE_URL',
    });
  });

  it('binds an env read in the same initializer', () => {
    const { datastoreRefs } = extract(
      `const url = process.env.PG_URL ?? 'postgresql://app:secret@localhost:5433/orders';`,
    );

    expect(datastoreRefs[0]).toMatchObject({
      url: 'postgresql://app:secret@localhost:5433/orders',
      scheme: 'postgresql',
      envVar: 'PG_URL',
    });
  });

  it('harvests every supported scheme, and nothing else', () => {
    const { datastoreRefs } = extract(`
      const a = 'mysql://localhost:3306/shop';
      const b = 'mongodb://localhost:27017/events';
      const c = 'redis://localhost:6379';
      const d = 'mariadb://localhost:3306/legacy';
      const e = 'amqp://localhost:5672';
      const f = 'https://api.stripe.com';
    `);

    expect(datastoreRefs.map((r) => r.scheme)).toEqual(['mysql', 'mongodb', 'redis', 'mariadb']);
  });

  it('a template literal contributes its head — host and port survive interpolation', () => {
    const { datastoreRefs } = extract('const url = `postgres://localhost:5432/${name}`;');

    expect(datastoreRefs[0].url).toBe('postgres://localhost:5432/');
  });

  it('an http URL in the same object does not compete for the binding (per-family one-URL rule)', () => {
    // Both keys bind: the http literal is not a datastore literal, so neither
    // suppresses the other's association.
    const { refs, datastoreRefs } = extract(`
      const env = process.env;
      const DEFAULTS = {
        API_URL: 'https://api.example-vendor.com',
        DATABASE_URL: 'postgres://localhost:5432/weather',
      };
    `);

    expect(refs[0]?.envVar).toBe('API_URL');
    expect(datastoreRefs[0]?.envVar).toBe('DATABASE_URL');
  });

  it('two datastore URLs in ONE expression bind neither — the one-URL rule holds', () => {
    const { datastoreRefs } = extract(
      `const url = process.env.DB ? 'postgres://localhost:5432/a' : 'postgres://localhost:5432/b';`,
    );

    expect(datastoreRefs).toHaveLength(2);
    expect(datastoreRefs.every((r) => r.envVar === undefined)).toBe(true);
  });

  it('a file that never reads the environment yields no key-based binding', () => {
    const { datastoreRefs } = extract(`
      const CONSTANTS = { DATABASE_URL: 'postgres://localhost:5432/weather' };
    `);

    expect(datastoreRefs).toHaveLength(1);
    expect(datastoreRefs[0].envVar).toBeUndefined();
  });

  it('non-JS/TS languages contribute nothing (the recorded follow-up)', () => {
    const python = extractExternalHttp(
      parseCode("URL = os.environ.get('DATABASE_URL', 'postgres://localhost:5432/x')", 'python'),
      '/repo/app.py',
      'python',
    );

    expect(python.datastoreRefs).toEqual([]);
  });
});

describe('collectDatastoreUrls', () => {
  it('orders by source location and dedupes (url, envVar)', () => {
    const files = [
      analyzed('/repo/src/z.ts', `const b = process.env.CACHE_URL ?? 'redis://localhost:6379';`),
      analyzed('/repo/src/a.ts', `const a = process.env.DATABASE_URL ?? 'postgres://localhost:5432/weather';`),
      // The same URL, same variable, written again: one fact, not two.
      analyzed('/repo/src/b.ts', `const c = process.env.DATABASE_URL ?? 'postgres://localhost:5432/weather';`),
    ];

    expect(collectDatastoreUrls(files).map((r) => `${r.scheme} ${r.envVar}`)).toEqual([
      'postgres DATABASE_URL',
      'redis CACHE_URL',
    ]);
  });

  it('is empty for a tree that writes no connection URL', () => {
    expect(collectDatastoreUrls([analyzed('/repo/src/a.ts', "const x = 'hello';")])).toEqual([]);
  });
});
