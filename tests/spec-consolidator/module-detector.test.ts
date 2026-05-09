import { describe, it, expect } from 'vitest';
import {
  detectModules,
  SHARED_MODULE,
  topicsInModule,
  type Claim,
} from '../../packages/spec-consolidator/src/index.js';

/**
 * Module detector — pin behavior for the cases the consolidator
 * actually sees in the wild:
 *
 *   - Compliance-style: 26 endpoints under /api/v1/infractions/* →
 *     module "infractions".
 *   - /health alone → module "health".
 *   - Cross-cutting auth/errors with global scope → "_shared".
 *   - Mixed module statuses fall back to module-level "shipped"; all-
 *     planned modules lift the status.
 *   - Strips api/, v1/, v2/ from paths before picking the module name.
 */

function endpoint(path: string, opts: Partial<Claim> = {}): Claim {
  return {
    id: opts.id ?? `id-${path}`,
    topic: 'endpoints',
    subject: `GET ${path}`,
    content: { method: 'GET', path },
    provenance: opts.provenance ?? { file: 'docs/x.md', line: 1, quote: 'q' },
    metadata: opts.metadata ?? {
      docKind: 'prd',
      lastTouched: '2026-01-01T00:00:00Z',
    },
  };
}

function shared(topic: Claim['topic'], subject: string): Claim {
  return {
    id: `id-${topic}-${subject}`,
    topic,
    subject,
    content: {},
    provenance: { file: 'docs/x.md', line: 1, quote: 'q' },
    metadata: { docKind: 'prd', lastTouched: '2026-01-01T00:00:00Z' },
  };
}

describe('detectModules — endpoint grouping', () => {
  it('groups Compliance-shaped endpoints into "infractions"', () => {
    const claims = [
      endpoint('/api/v1/infractions/customer-overcharged'),
      endpoint('/api/v1/infractions/duplicate-discount'),
      endpoint('/api/v1/infractions/no-payment-collected'),
    ];
    const out = detectModules(claims);
    const names = out.modules.map((m) => m.name);
    expect(names).toContain('infractions');
    const infractions = out.modules.find((m) => m.name === 'infractions')!;
    expect(infractions.claims).toHaveLength(3);
  });

  it('puts /health into its own module "health"', () => {
    const claims = [endpoint('/health')];
    const out = detectModules(claims);
    expect(out.modules.map((m) => m.name)).toEqual(['health']);
  });

  it('strips api / v1 / v2 prefixes when deriving the module name', () => {
    const claims = [
      endpoint('/api/v1/users'),
      endpoint('/api/v2/users/{id}'),
      endpoint('/v1/orders'),
      endpoint('/api/payments'),
    ];
    const out = detectModules(claims);
    const names = out.modules.map((m) => m.name).sort();
    expect(names).toEqual(['orders', 'payments', 'users']);
  });

  it('skips dynamic segments — :id and {id} are never module names', () => {
    const claims = [
      endpoint('/:id'),                // pathological but should not crash
      endpoint('/{id}/edit'),          // ditto
      endpoint('/api/v1/{slug}/info'), // module = "info"
    ];
    const out = detectModules(claims);
    const names = out.modules.map((m) => m.name);
    expect(names).toContain('info');
  });

  it('groups multiple endpoints sharing a path prefix into one module', () => {
    const claims = [
      endpoint('/api/v1/orders'),
      endpoint('/api/v1/orders/{id}'),
      endpoint('/api/v1/orders/{id}/pay'),
      endpoint('/api/v1/customers'),
    ];
    const out = detectModules(claims);
    const orders = out.modules.find((m) => m.name === 'orders')!;
    const customers = out.modules.find((m) => m.name === 'customers')!;
    expect(orders.claims).toHaveLength(3);
    expect(customers.claims).toHaveLength(1);
  });
});

describe('detectModules — cross-cutting topics → _shared', () => {
  it('routes a global auth claim with no path-shaped subject to _shared', () => {
    const claims = [shared('auth', 'auth scheme')];
    const out = detectModules(claims);
    const sharedMod = out.modules.find((m) => m.name === SHARED_MODULE);
    expect(sharedMod).toBeDefined();
    expect(sharedMod!.claims).toHaveLength(1);
  });

  it('routes errors / effects with no path subject to _shared', () => {
    const claims = [
      shared('errors', 'global error envelope'),
      shared('effects', 'order.placed event'),
    ];
    const out = detectModules(claims);
    const sharedMod = out.modules.find((m) => m.name === SHARED_MODULE)!;
    expect(sharedMod.claims).toHaveLength(2);
  });

  it('attributes a path-shaped auth subject to its derived module', () => {
    // "auth on /api/v1/admin/*" should become a module-scoped claim,
    // not a _shared one.
    const claim: Claim = {
      ...shared('auth', '/api/v1/admin/*'),
      content: { scope: '/api/v1/admin/*' },
    };
    const out = detectModules([claim]);
    expect(out.modules.map((m) => m.name)).toContain('admin');
  });

  it('emits _shared first in module ordering for dashboard pinning', () => {
    const claims = [
      endpoint('/api/v1/orders'),
      shared('auth', 'global scheme'),
    ];
    const out = detectModules(claims);
    expect(out.modules[0].name).toBe(SHARED_MODULE);
  });
});

describe('detectModules — manifest derivation', () => {
  it('lifts a uniform out-of-scope status to the module level', () => {
    const a = { ...endpoint('/api/v1/infractions/foo'), metadata: { docKind: 'prd' as const, lastTouched: 't', status: 'out-of-scope' as const } };
    const b = { ...endpoint('/api/v1/infractions/bar'), metadata: { docKind: 'prd' as const, lastTouched: 't', status: 'out-of-scope' as const } };
    const out = detectModules([a, b]);
    const m = out.modules.find((mod) => mod.name === 'infractions')!;
    expect(m.manifest.status).toBe('out-of-scope');
  });

  it('falls back to "shipped" when statuses disagree across the module', () => {
    const a = { ...endpoint('/api/v1/orders'), metadata: { docKind: 'prd' as const, lastTouched: 't', status: 'shipped' as const } };
    const b = { ...endpoint('/api/v1/orders/refund'), metadata: { docKind: 'prd' as const, lastTouched: 't', status: 'planned' as const } };
    const out = detectModules([a, b]);
    expect(out.modules.find((m) => m.name === 'orders')!.manifest.status).toBe('shipped');
  });

  it('produces a scope.paths glob ending in /** for each module', () => {
    const claims = [
      endpoint('/api/v1/infractions/foo'),
      endpoint('/api/v1/infractions/bar/baz'),
    ];
    const out = detectModules(claims);
    const m = out.modules.find((mod) => mod.name === 'infractions')!;
    expect(m.manifest.scope.paths).toBeDefined();
    expect(m.manifest.scope.paths![0]).toMatch(/infractions\/\*\*$/);
  });

  it('uses tags scope (no paths) for _shared', () => {
    const out = detectModules([shared('auth', 'global scheme')]);
    const sharedMod = out.modules.find((m) => m.name === SHARED_MODULE)!;
    expect(sharedMod.manifest.scope.paths).toBeUndefined();
    expect(sharedMod.manifest.scope.tags).toEqual(['shared']);
  });

  it('lists every source doc that contributed claims to the module', () => {
    const claims = [
      { ...endpoint('/api/v1/orders'), provenance: { file: 'docs/PRDs/v1.md', line: 1, quote: 'q' } },
      { ...endpoint('/api/v1/orders/{id}'), provenance: { file: 'docs/PRDs/v2.md', line: 1, quote: 'q' } },
      { ...endpoint('/api/v1/orders/{id}/pay'), provenance: { file: 'docs/PRDs/v1.md', line: 1, quote: 'q' } },
    ];
    const out = detectModules(claims);
    const m = out.modules.find((mod) => mod.name === 'orders')!;
    expect(m.manifest.sourceDocs).toEqual(['docs/PRDs/v1.md', 'docs/PRDs/v2.md']);
  });
});

describe('topicsInModule helper', () => {
  it('returns the unique sorted topic set of a module', () => {
    const claims = [
      endpoint('/api/v1/orders'),
      { ...shared('auth', '/api/v1/orders/*'), content: { scope: '/api/v1/orders/*' } },
    ];
    const out = detectModules(claims);
    const orders = out.modules.find((m) => m.name === 'orders')!;
    expect(topicsInModule(orders)).toEqual(['auth', 'endpoints']);
  });
});
