/**
 * THE RPC GENERATION GATE (SPEC_GUARD_PLAN item 12).
 *
 * A mounted tRPC tree derives real, invocable api interfaces — and this round
 * they are deliberately NOT authored against: the request body of
 * `POST /api/trpc/post.create` is the procedure's input schema inside tRPC's own
 * `?input=` envelope, and whether a scenario should be written in that encoding
 * is a separate decision. So they stay in the catalog (the web context pack joins
 * a screen's `trpc.…` calls to exactly these ids) and out of everything that
 * feeds authoring.
 *
 * The surface catalog is where that gate has the most reach: it is the matcher's
 * candidate set, the source of the "other operations" block, and the SURFACE
 * FINGERPRINT — so a repo that gains the RPC derivation must not re-author a
 * single scenario, and this is the test that says so.
 */

import { describe, it, expect } from 'vitest';
import { buildSurfaceCatalogs } from '../../packages/guard-generator/src/match';
import type { Interface } from '../../packages/shared/src';

function apiInterface(method: string, path: string, procedure?: string): Interface {
  return {
    id: `api/${method.toLowerCase()}${path.replace(/\W+/g, '-')}`,
    type: 'api',
    title: `${method} ${path}`,
    entry: { method, path },
    steps: [{ kind: 'request', method, path }],
    fingerprint: `fp-${method}-${path}`,
    ...(procedure ? { procedure } : {}),
  } as Interface;
}

const ROUTES = [apiInterface('GET', '/v1/posts'), apiInterface('POST', '/v1/posts')];
const PROCEDURES = [
  apiInterface('GET', '/api/trpc/post.getLatest', 'post.getLatest'),
  apiInterface('POST', '/api/trpc/post.create', 'post.create'),
];

describe('buildSurfaceCatalogs — the RPC exclusion', () => {
  it('keeps RPC-derived operations out of the matcher’s candidate set', () => {
    const catalogs = buildSurfaceCatalogs([...ROUTES, ...PROCEDURES]);
    expect(catalogs.get('api')?.interfaces.map((j) => j.id)).toEqual([
      'api/get-v1-posts',
      'api/post-v1-posts',
    ]);
  });

  it('leaves the surface fingerprint exactly where it was', () => {
    // The whole point of gating here: deriving a repo's tRPC tree for the first
    // time must not move the cache key that decides what gets re-authored.
    expect(buildSurfaceCatalogs([...ROUTES, ...PROCEDURES]).get('api')?.fingerprint).toBe(
      buildSurfaceCatalogs(ROUTES).get('api')?.fingerprint,
    );
  });

  it('offers no api surface at all for a repo whose ONLY operations are procedures', () => {
    // Honest degradation: a pure tRPC app has no api scenarios this round, and
    // an empty catalog says that. It does not say the app has no server.
    expect(buildSurfaceCatalogs(PROCEDURES).has('api')).toBe(false);
  });
});
