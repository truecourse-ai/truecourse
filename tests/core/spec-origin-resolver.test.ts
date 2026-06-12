import { describe, it, expect } from 'vitest';
import {
  buildClaimIndex,
  resolveSpecOrigin,
  resolveDriftOrigins,
  collectOriginSources,
  attachOriginLinks,
} from '../../packages/core/src/lib/spec-origin-resolver';

// A minimal claims.json mirroring the real shape the resolver reads: the orders
// module's endpoint claims, each tracing to a repo doc + line (validated against
// real stored data: subject "GET /api/orders/:id" → docs/PRDs/orders_PRDv2.md:169).
const claims = {
  version: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  modules: [],
  claims: [
    {
      module: 'orders',
      topic: 'endpoints',
      subject: 'GET /api/orders/:id',
      provenance: { file: 'docs/PRDs/orders_PRDv2.md', line: 169, quote: '' },
    },
    {
      module: 'orders',
      topic: 'endpoints',
      subject: 'POST /api/orders',
      provenance: { file: 'docs/PRDs/orders_PRDv2.md', line: 146, quote: '' },
    },
    {
      module: 'customers',
      topic: 'auth',
      subject: 'session cookie',
      provenance: { file: 'docs/PRDs/customers.md', line: 12, quote: '' },
    },
    // A multi-claim group whose subject is separated by ` → ` (not ` / `), and
    // where every claim traces to the SAME doc (exercises the file-level fallback).
    {
      module: '_shared',
      topic: 'errors',
      subject: 'global error envelope',
      provenance: { file: 'docs/PRDs/orders_PRDv2.md', line: 250, quote: '' },
    },
    {
      module: '_shared',
      topic: 'errors',
      subject: 'email_taken',
      provenance: { file: 'docs/PRDs/orders_PRDv2.md', line: 255, quote: '' },
    },
    // A multi-claim group spanning TWO docs — an unmatched subject here is genuinely
    // ambiguous (no single source file), so it must stay unresolved.
    {
      module: 'billing',
      topic: 'data',
      subject: 'Invoice',
      provenance: { file: 'docs/PRDs/billing.md', line: 10, quote: '' },
    },
    {
      module: 'billing',
      topic: 'data',
      subject: 'LineItem',
      provenance: { file: 'docs/specs/line-item.md', line: 5, quote: '' },
    },
  ],
} as never;

const ptr = (source: string, section: string) => ({
  source,
  section,
  lines: [1, 235] as [number, number],
});

describe('resolveSpecOrigin (claims pointer → real provenance)', () => {
  const index = buildClaimIndex(claims);

  it('re-points a claims.json#module/topic pointer to the matching claim subject', () => {
    const out = resolveSpecOrigin(
      ptr('claims.json#orders/endpoints', 'orders → endpoints / GET /api/orders/:id'),
      index,
    );
    expect(out).toEqual({
      source: 'docs/PRDs/orders_PRDv2.md',
      section: 'orders → endpoints / GET /api/orders/:id',
      lines: [169, 169],
    });
  });

  it('disambiguates within a (module, topic) group by the section subject', () => {
    const out = resolveSpecOrigin(
      ptr('claims.json#orders/endpoints', 'orders → endpoints / POST /api/orders'),
      index,
    );
    expect(out?.source).toBe('docs/PRDs/orders_PRDv2.md');
    expect(out?.lines).toEqual([146, 146]);
  });

  it('handles the .truecourse/specs/ prefix on the pointer', () => {
    const out = resolveSpecOrigin(
      ptr('.truecourse/specs/claims.json#orders/endpoints', 'orders → endpoints / GET /api/orders/:id'),
      index,
    );
    expect(out?.source).toBe('docs/PRDs/orders_PRDv2.md');
  });

  it('recovers module/topic from the section when the LLM strips the fragment', () => {
    const out = resolveSpecOrigin(
      ptr('claims.json', 'customers → auth / session cookie'),
      index,
    );
    expect(out?.source).toBe('docs/PRDs/customers.md');
    expect(out?.lines).toEqual([12, 12]);
  });

  it('uses the sole claim when a group has exactly one and the subject does not match', () => {
    const out = resolveSpecOrigin(
      ptr('claims.json#customers/auth', 'customers → auth / something else entirely'),
      index,
    );
    expect(out?.source).toBe('docs/PRDs/customers.md');
  });

  it('extracts a subject separated by an extra " → " (errors-style heading)', () => {
    const out = resolveSpecOrigin(
      ptr('claims.json#_shared/errors', '_shared → errors → global error envelope'),
      index,
    );
    expect(out?.source).toBe('docs/PRDs/orders_PRDv2.md');
    expect(out?.lines).toEqual([250, 250]);
  });

  it('falls back to a file-level link when the subject is unmatched but the group shares one doc', () => {
    // "customers table / query rules" doesn't match any _shared/errors subject, but
    // every claim in the group is from the same doc → resolve the file, no line.
    const out = resolveSpecOrigin(
      ptr('claims.json#_shared/errors', 'customers table / query rules'),
      index,
    );
    expect(out?.source).toBe('docs/PRDs/orders_PRDv2.md');
    expect(out?.lines).toEqual([-1, -1]);
  });

  it('leaves a real repo-doc origin untouched', () => {
    const origin = ptr('docs/PRDs/orders_PRDv2.md', 'Out of scope');
    expect(resolveSpecOrigin(origin, index)).toBe(origin);
  });

  it('leaves an unresolvable pointer (no matching module/topic) untouched', () => {
    const origin = ptr('claims.json#ghost/missing', 'ghost → missing / whatever');
    expect(resolveSpecOrigin(origin, index)).toBe(origin);
  });

  it('leaves a multi-doc group with an unmatched subject unresolved (genuinely ambiguous)', () => {
    // billing/data has 2 claims from 2 different docs; an unknown subject can't be
    // pinned and there's no single file to fall back to.
    const origin = ptr('claims.json#billing/data', 'billing → data / Receipt');
    expect(resolveSpecOrigin(origin, index)).toBe(origin);
  });
});

describe('resolveDriftOrigins', () => {
  it('resolves drift specOrigins and passes through drifts without one', () => {
    const drifts = [
      { id: 'a', specOrigin: ptr('claims.json#orders/endpoints', 'orders → endpoints / GET /api/orders/:id') },
      { id: 'b' },
      { id: 'c', specOrigin: ptr('docs/PRDs/orders_PRDv2.md', 'Out of scope') },
    ];
    const out = resolveDriftOrigins(drifts, claims);
    expect(out[0].specOrigin?.source).toBe('docs/PRDs/orders_PRDv2.md');
    expect(out[0].specOrigin?.lines).toEqual([169, 169]);
    expect(out[1]).toEqual({ id: 'b' });
    expect(out[2].specOrigin?.source).toBe('docs/PRDs/orders_PRDv2.md');
  });

  it('is a no-op when there are no claims to resolve against', () => {
    const drifts = [{ id: 'a', specOrigin: ptr('claims.json#orders/endpoints', 'x') }];
    expect(resolveDriftOrigins(drifts, null)).toBe(drifts);
  });
});

describe('workspace-doc links (collectOriginSources / attachOriginLinks)', () => {
  it('collects distinct origin sources, skipping drifts without an origin', () => {
    const drifts = [
      { specOrigin: ptr('knowledge/confluence/98525.md', 'auth') },
      { specOrigin: ptr('knowledge/confluence/98525.md', 'auth again') },
      { specOrigin: ptr('docs/PRDs/orders_PRDv2.md', 'x') },
      { id: 'no-origin' },
    ];
    expect(collectOriginSources(drifts).sort()).toEqual([
      'docs/PRDs/orders_PRDv2.md',
      'knowledge/confluence/98525.md',
    ]);
  });

  it('attaches sourceUrl + sourceLabel to workspace-doc origins, leaving repo docs untouched', () => {
    const drifts = [
      { id: 'a', specOrigin: ptr('knowledge/confluence/98525.md', 'auth') },
      { id: 'b', specOrigin: ptr('docs/PRDs/orders_PRDv2.md', 'x') },
    ];
    const links = new Map([
      [
        'knowledge/confluence/98525.md',
        { url: 'https://wiki.example/pages/98525', title: 'ADR 0001 — Authentication scheme' },
      ],
    ]);
    const out = attachOriginLinks(drifts, links);
    expect(out[0].specOrigin?.sourceUrl).toBe('https://wiki.example/pages/98525');
    expect(out[0].specOrigin?.sourceLabel).toBe('ADR 0001 — Authentication scheme');
    expect(out[1].specOrigin?.sourceUrl).toBeUndefined();
  });

  it('does not attach a link with a null url', () => {
    const drifts = [{ specOrigin: ptr('knowledge/manual/x.md', 'y') }];
    const links = new Map([['knowledge/manual/x.md', { url: null, title: 'Manual doc' }]]);
    expect(attachOriginLinks(drifts, links)[0].specOrigin?.sourceUrl).toBeUndefined();
  });

  it('is a no-op with an empty link map', () => {
    const drifts = [{ specOrigin: ptr('knowledge/confluence/1.md', 'a') }];
    expect(attachOriginLinks(drifts, new Map())).toBe(drifts);
  });
});
