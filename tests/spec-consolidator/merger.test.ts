import { describe, it, expect } from 'vitest';
import {
  mergeClaims,
  candidateFingerprint,
  type Claim,
  type DecisionsFile,
} from '../../packages/spec-consolidator/src/index.js';

/**
 * Merger tests pin the load-bearing behaviors:
 *
 *   - Singletons pass through unchanged.
 *   - Multi-source agreement auto-merges; provenance is stitched, not lost.
 *   - Any difference (content or status) → Conflict (Q2).
 *   - Conflict candidates ordered oldest→newest; defaultPick = newest (Q10).
 *   - Resolutions in decisions.json suppress conflicts (Q13 persistence).
 *   - Conflict id stable across runs for the same candidate set;
 *     changes when the set changes (so stale decisions don't silently apply).
 *   - Stable JSON stringify — key reordering doesn't create false conflicts.
 */

function makeClaim(overrides: Partial<Claim> & {
  subject: string;
  topic?: Claim['topic'];
  content?: unknown;
  status?: Claim['metadata']['status'];
  file?: string;
  line?: number;
  lastTouched?: string;
  docKind?: Claim['metadata']['docKind'];
  id?: string;
}): Claim {
  return {
    id: overrides.id ?? `id-${overrides.file ?? 'x'}-${overrides.subject}`,
    topic: overrides.topic ?? 'endpoints',
    subject: overrides.subject,
    content: overrides.content ?? { method: 'POST', path: '/orders' },
    provenance: {
      file: overrides.file ?? 'docs/x.md',
      line: overrides.line ?? 1,
      quote: 'q',
    },
    metadata: {
      docKind: overrides.docKind ?? 'prd',
      status: overrides.status,
      lastTouched: overrides.lastTouched ?? '2026-01-01T00:00:00Z',
    },
  };
}

describe('mergeClaims — singletons + auto-merge', () => {
  it('passes singletons through unchanged', () => {
    const c = makeClaim({ subject: 'POST /orders' });
    const out = mergeClaims([c]);
    expect(out.resolvedClaims).toEqual([c]);
    expect(out.openConflicts).toEqual([]);
    expect(out.decidedConflicts).toEqual([]);
  });

  it('auto-merges identical content+status from multiple sources', () => {
    const a = makeClaim({
      id: 'id-a',
      subject: 'POST /orders',
      file: 'docs/PRDs/v1.md',
      lastTouched: '2025-01-01T00:00:00Z',
    });
    const b = makeClaim({
      id: 'id-b',
      subject: 'POST /orders',
      file: 'docs/PRDs/v2.md',
      lastTouched: '2026-01-01T00:00:00Z',
    });
    const out = mergeClaims([a, b]);
    expect(out.resolvedClaims).toHaveLength(1);
    expect(out.openConflicts).toEqual([]);
    // Provenance stitched so the canonical writer can show all sources.
    expect(out.resolvedClaims[0].provenance.quote).toContain('docs/PRDs/v1.md');
    expect(out.resolvedClaims[0].provenance.quote).toContain('docs/PRDs/v2.md');
  });

  it('does not get fooled by JSON key-order differences (stable stringify)', () => {
    const a = makeClaim({
      id: 'id-a',
      subject: 'GET /users',
      content: { method: 'GET', path: '/users' },
    });
    const b = makeClaim({
      id: 'id-b',
      subject: 'GET /users',
      content: { path: '/users', method: 'GET' }, // same shape, different key order
    });
    const out = mergeClaims([a, b]);
    expect(out.openConflicts).toHaveLength(0);
    expect(out.resolvedClaims).toHaveLength(1);
  });
});

describe('mergeClaims — conflicts', () => {
  it('emits a Conflict when content differs', () => {
    const a = makeClaim({
      id: 'id-a',
      subject: 'POST /orders',
      content: { method: 'POST', responses: { '200': {} } },
      lastTouched: '2025-01-01T00:00:00Z',
    });
    const b = makeClaim({
      id: 'id-b',
      subject: 'POST /orders',
      content: { method: 'POST', responses: { '201': {} } },
      lastTouched: '2026-01-01T00:00:00Z',
    });
    const out = mergeClaims([a, b]);
    expect(out.openConflicts).toHaveLength(1);
    expect(out.resolvedClaims).toEqual([]);
  });

  it('resolves identical-content claims with differing status using status priority (shipped > unset > deferred > out-of-scope > deprecated)', () => {
    // Updated from the original "Q2 strict" rule. On real projects the
    // same claim routinely appears with mixed status tags (PRD says
    // `shipped`, runbook has no tag, research log marks `deferred`) and
    // asking the user to pick between identical contents is pure noise.
    // The merger now picks the highest-priority status; `out-of-scope`
    // and `deprecated` lose to active claims. Genuine content
    // disagreements still surface as conflicts.
    const a = makeClaim({
      id: 'id-a',
      subject: 'POST /api/v1/wrong-job-type',
      status: 'shipped',
      lastTouched: '2025-01-01T00:00:00Z',
    });
    const b = makeClaim({
      id: 'id-b',
      subject: 'POST /api/v1/wrong-job-type',
      status: 'out-of-scope',
      lastTouched: '2026-01-01T00:00:00Z',
    });
    const out = mergeClaims([a, b]);
    // `out-of-scope` lost to `shipped` via the status filter, leaving
    // one active claim — surfaces as a singleton resolution, not a
    // conflict.
    expect(out.openConflicts).toHaveLength(0);
    expect(out.resolvedClaims).toHaveLength(1);
    expect(out.resolvedClaims[0].metadata.status).toBe('shipped');
  });

  it('orders candidates oldest → newest with defaultPick = newest (Q10)', () => {
    const old = makeClaim({
      id: 'id-old',
      subject: 'auth scheme',
      topic: 'auth',
      content: { scheme: 'Session' },
      lastTouched: '2024-01-01T00:00:00Z',
    });
    const recent = makeClaim({
      id: 'id-recent',
      subject: 'auth scheme',
      topic: 'auth',
      content: { scheme: 'Bearer JWT' },
      lastTouched: '2026-04-01T00:00:00Z',
    });
    const newest = makeClaim({
      id: 'id-newest',
      subject: 'auth scheme',
      topic: 'auth',
      content: { scheme: 'Auth0 JWT' },
      lastTouched: '2026-05-01T00:00:00Z',
    });
    // Pass in random order — merger must sort.
    const out = mergeClaims([recent, old, newest]);
    const c = out.openConflicts[0];
    expect(c.candidates.map((cand) => cand.claim.id)).toEqual([
      'id-old',
      'id-recent',
      'id-newest',
    ]);
    expect(c.defaultPick).toBe(2);
    expect(c.candidates[2].weight).toBe('newest');
    expect(c.candidates[0].weight).toBe('oldest');
  });

  it('groups by topic+subject — same path under different topics is two distinct groups', () => {
    const ep = makeClaim({
      subject: '/api/auth',
      topic: 'endpoints',
    });
    const auth = makeClaim({
      subject: '/api/auth',
      topic: 'auth',
    });
    const out = mergeClaims([ep, auth]);
    expect(out.resolvedClaims).toHaveLength(2);
    expect(out.openConflicts).toHaveLength(0);
  });
});

describe('mergeClaims — decisions persistence (Q13)', () => {
  function makePair() {
    const a = makeClaim({
      id: 'id-a',
      subject: 'POST /orders',
      content: { resp: '200' },
      lastTouched: '2025-01-01T00:00:00Z',
    });
    const b = makeClaim({
      id: 'id-b',
      subject: 'POST /orders',
      content: { resp: '201' },
      lastTouched: '2026-01-01T00:00:00Z',
    });
    return { a, b };
  }

  it('honors a `pick` decision — conflict moves to decidedConflicts with resolvedClaim', () => {
    const { a, b } = makePair();
    const initial = mergeClaims([a, b]);
    const conflict = initial.openConflicts[0];
    const decisions: DecisionsFile = {
      version: 1,
      decisions: [
        {
          conflictId: conflict.id,
          resolution: { kind: 'pick', candidateIndex: 0 }, // user picked the older one
          resolvedAt: '2026-05-01T00:00:00Z',
          candidateFingerprint: candidateFingerprint(conflict),
        },
      ],
    };
    const out = mergeClaims([a, b], decisions);
    expect(out.openConflicts).toEqual([]);
    expect(out.decidedConflicts).toHaveLength(1);
    expect(out.decidedConflicts[0].resolvedClaim?.id).toBe('id-a');
  });

  it('honors a `custom` decision — surfaced as decidedConflict without resolvedClaim', () => {
    const { a, b } = makePair();
    const initial = mergeClaims([a, b]);
    const conflict = initial.openConflicts[0];
    const decisions: DecisionsFile = {
      version: 1,
      decisions: [
        {
          conflictId: conflict.id,
          resolution: { kind: 'custom', content: 'whatever the user typed' },
          resolvedAt: '2026-05-01T00:00:00Z',
          candidateFingerprint: candidateFingerprint(conflict),
        },
      ],
    };
    const out = mergeClaims([a, b], decisions);
    expect(out.openConflicts).toEqual([]);
    expect(out.decidedConflicts).toHaveLength(1);
    expect(out.decidedConflicts[0].resolvedClaim).toBeUndefined();
    expect(out.decidedConflicts[0].decision.resolution.kind).toBe('custom');
  });

  it('decisions for stale conflict ids are ignored (no silent application)', () => {
    const { a, b } = makePair();
    const stale: DecisionsFile = {
      version: 1,
      decisions: [
        {
          conflictId: 'stale-id-not-in-current-set',
          resolution: { kind: 'pick', candidateIndex: 0 },
          resolvedAt: '2026-05-01T00:00:00Z',
          candidateFingerprint: 'fp',
        },
      ],
    };
    const out = mergeClaims([a, b], stale);
    expect(out.openConflicts).toHaveLength(1);
    expect(out.decidedConflicts).toEqual([]);
  });
});

describe('mergeClaims — conflict id stability', () => {
  it('same candidate set produces the same conflict id across runs', () => {
    const a = makeClaim({ id: 'id-a', subject: 'POST /x', content: { v: 1 }, lastTouched: '2025-01-01T00:00:00Z' });
    const b = makeClaim({ id: 'id-b', subject: 'POST /x', content: { v: 2 }, lastTouched: '2026-01-01T00:00:00Z' });
    const r1 = mergeClaims([a, b]);
    const r2 = mergeClaims([b, a]); // input order shouldn't matter
    expect(r1.openConflicts[0].id).toBe(r2.openConflicts[0].id);
  });

  it('adding a third candidate produces a new conflict id (so stale resolutions don\'t apply silently)', () => {
    const a = makeClaim({ id: 'id-a', subject: 'POST /x', content: { v: 1 }, lastTouched: '2025-01-01T00:00:00Z' });
    const b = makeClaim({ id: 'id-b', subject: 'POST /x', content: { v: 2 }, lastTouched: '2026-01-01T00:00:00Z' });
    const c = makeClaim({ id: 'id-c', subject: 'POST /x', content: { v: 3 }, lastTouched: '2026-04-01T00:00:00Z' });
    const r1 = mergeClaims([a, b]);
    const r2 = mergeClaims([a, b, c]);
    expect(r1.openConflicts[0].id).not.toBe(r2.openConflicts[0].id);
  });
});

describe('mergeClaims — output ordering', () => {
  it('emits resolvedClaims in deterministic topic+subject order', () => {
    const c1 = makeClaim({ topic: 'endpoints', subject: 'POST /b' });
    const c2 = makeClaim({ topic: 'endpoints', subject: 'POST /a' });
    const c3 = makeClaim({ topic: 'auth', subject: 'scheme' });
    const out = mergeClaims([c1, c2, c3]);
    const keys = out.resolvedClaims.map((c) => `${c.topic}::${c.subject}`);
    expect(keys).toEqual([
      'auth::scheme',
      'endpoints::POST /a',
      'endpoints::POST /b',
    ]);
  });
});
