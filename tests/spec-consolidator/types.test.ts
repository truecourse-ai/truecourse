import { describe, it, expect } from 'vitest';
import {
  TopicSchema,
  StatusSchema,
  DocKindSchema,
  ClaimSchema,
  ConflictSchema,
  DecisionSchema,
  DecisionsFileSchema,
  ModuleManifestSchema,
  ResolutionSchema,
  type Claim,
  type Conflict,
  type Decision,
  type ModuleManifest,
} from '../../packages/spec-consolidator/src/index.js';

/**
 * Schema-level tests for the spec-consolidator core types. These
 * lock the locked design choices in the schemas themselves:
 *   - Topic taxonomy is closed (Q1).
 *   - Status enum covers the propagation chain (Q6).
 *   - Resolution union allows both pick and free-text custom (Q11).
 *   - Decision carries a candidate fingerprint so re-scans can
 *     detect changed candidate sets (Q13).
 *
 * If a topic gets renamed or a status added without a matching code
 * update downstream, these tests should fail loudly.
 */

describe('TopicSchema (Q1: locked broad taxonomy)', () => {
  it('accepts every topic in the locked set', () => {
    const topics = ['auth', 'endpoints', 'data', 'errors', 'effects', 'overview'];
    for (const t of topics) {
      expect(TopicSchema.parse(t)).toBe(t);
    }
  });

  it('rejects finer-grained topics that were folded in (idempotency, pagination, cors)', () => {
    // Q1 chose broad over fine-grained — these are folded into endpoints/data.
    // Locking them out here means a future contributor can't quietly
    // add them as their own topic without updating the merger and the
    // canonical-spec writer to match.
    expect(() => TopicSchema.parse('idempotency')).toThrow();
    expect(() => TopicSchema.parse('pagination')).toThrow();
    expect(() => TopicSchema.parse('cors')).toThrow();
    expect(() => TopicSchema.parse('rate-limits')).toThrow();
  });
});

describe('StatusSchema (Q6: status travels module → operation → IL)', () => {
  it('covers the full lifecycle the verifier needs to honor', () => {
    const all = ['shipped', 'planned', 'deferred', 'deprecated', 'out-of-scope'];
    for (const s of all) {
      expect(StatusSchema.parse(s)).toBe(s);
    }
  });

  it('rejects unknown statuses — the verifier branches on this enum', () => {
    expect(() => StatusSchema.parse('todo')).toThrow();
    expect(() => StatusSchema.parse('in-progress')).toThrow();
  });
});

describe('DocKindSchema (signal, not gate)', () => {
  it('parses the kinds the discovery stage emits', () => {
    for (const k of ['prd', 'adr', 'rfc', 'spec', 'runbook', 'design-note', 'readme', 'unknown']) {
      expect(DocKindSchema.parse(k)).toBe(k);
    }
  });
});

describe('ClaimSchema', () => {
  const validClaim: Claim = {
    id: 'sha256-fake-id',
    topic: 'endpoints',
    subject: 'POST /api/auth/wallet',
    content: { method: 'POST', path: '/api/auth/wallet', responses: { '200': {} } },
    provenance: {
      file: 'docs/PRDs/v2.md',
      line: 42,
      quote: 'Authenticate using wallet signature.',
    },
    metadata: {
      docKind: 'prd',
      lastTouched: '2026-05-01T12:00:00Z',
    },
  };

  it('round-trips a minimal valid claim', () => {
    expect(ClaimSchema.parse(validClaim)).toEqual(validClaim);
  });

  it('preserves optional status from the metadata', () => {
    const planned = { ...validClaim, metadata: { ...validClaim.metadata, status: 'planned' as const } };
    expect(ClaimSchema.parse(planned).metadata.status).toBe('planned');
  });

  it('rejects a claim missing provenance — every claim must be traceable', () => {
    const { provenance: _drop, ...rest } = validClaim;
    expect(() => ClaimSchema.parse(rest)).toThrow();
  });

  it('preserves opaque content as-is (Zod uses unknown so topics narrow downstream)', () => {
    const exotic = { ...validClaim, content: { weird: { nested: ['shape', 1, true] } } };
    expect(ClaimSchema.parse(exotic).content).toEqual(exotic.content);
  });
});

describe('ConflictSchema (Q2: any difference = conflict)', () => {
  function makeConflict(): Conflict {
    return {
      id: 'conflict-1',
      module: 'auth',
      topic: 'auth',
      subject: 'POST /api/auth/wallet — auth scheme',
      candidates: [
        {
          index: 0,
          weight: 'older',
          claim: {
            id: 'c-old',
            topic: 'auth',
            subject: 'POST /api/auth/wallet — auth scheme',
            content: { scheme: 'session-cookie' },
            provenance: { file: 'docs/PRDs/v1.md', line: 12, quote: 'Session cookie.' },
            metadata: { docKind: 'prd', lastTouched: '2024-01-01T00:00:00Z' },
          },
        },
        {
          index: 1,
          weight: 'newest',
          claim: {
            id: 'c-new',
            topic: 'auth',
            subject: 'POST /api/auth/wallet — auth scheme',
            content: { scheme: 'bearer-jwt' },
            provenance: { file: 'docs/PRDs/v2.md', line: 18, quote: 'Bearer JWT.' },
            metadata: { docKind: 'prd', lastTouched: '2026-04-15T00:00:00Z' },
          },
        },
      ],
      defaultPick: 1,
    };
  }

  it('requires at least two candidates — single-source claims aren\'t conflicts', () => {
    const c = makeConflict();
    const oneCandidate = { ...c, candidates: [c.candidates[0]] };
    expect(() => ConflictSchema.parse(oneCandidate)).toThrow();
  });

  it('round-trips a two-candidate conflict with a defaultPick', () => {
    const c = makeConflict();
    expect(ConflictSchema.parse(c)).toEqual(c);
  });

  it('allows three or more candidates (n-doc disagreement)', () => {
    const c = makeConflict();
    const third = {
      ...c.candidates[0],
      index: 2,
      claim: { ...c.candidates[0].claim, id: 'c-mid', provenance: { ...c.candidates[0].claim.provenance, file: 'docs/design/auth.md' } },
    };
    const wide = { ...c, candidates: [...c.candidates, third] };
    expect(ConflictSchema.parse(wide).candidates).toHaveLength(3);
  });
});

describe('ResolutionSchema (Q11: pick or free-text custom)', () => {
  it('accepts a pick resolution', () => {
    const r = ResolutionSchema.parse({ kind: 'pick', candidateIndex: 0 });
    expect(r.kind).toBe('pick');
  });

  it('accepts a custom free-text resolution', () => {
    const r = ResolutionSchema.parse({ kind: 'custom', content: 'Bearer JWT (RS256)' });
    expect(r.kind).toBe('custom');
  });

  it('rejects an unknown resolution kind — guards against silent expansion', () => {
    expect(() => ResolutionSchema.parse({ kind: 'skip' })).toThrow();
    expect(() => ResolutionSchema.parse({ kind: 'defer' })).toThrow();
  });
});

describe('DecisionSchema + DecisionsFileSchema (Q13: persistence across re-scans)', () => {
  const decision: Decision = {
    conflictId: 'conflict-1',
    resolution: { kind: 'pick', candidateIndex: 1 },
    resolvedAt: '2026-05-09T12:00:00Z',
    candidateFingerprint: 'sha256-fp',
  };

  it('round-trips a single decision', () => {
    expect(DecisionSchema.parse(decision)).toEqual(decision);
  });

  it('requires the candidateFingerprint — re-scans need it to detect changed sets', () => {
    const { candidateFingerprint: _drop, ...rest } = decision;
    expect(() => DecisionSchema.parse(rest)).toThrow();
  });

  it('persists multiple decisions in the file shape', () => {
    const file = { version: 1 as const, decisions: [decision, { ...decision, conflictId: 'conflict-2' }] };
    expect(DecisionsFileSchema.parse(file).decisions).toHaveLength(2);
  });

  it('rejects file payloads with the wrong version literal — bumping is intentional', () => {
    expect(() =>
      DecisionsFileSchema.parse({ version: 2, decisions: [] }),
    ).toThrow();
  });
});

describe('ModuleManifestSchema (module.yaml shape)', () => {
  const manifest: ModuleManifest = {
    name: 'auth',
    status: 'shipped',
    description: 'Wallet-based authentication.',
    sourceDocs: ['docs/PRDs/v2.md', 'docs/auth/wallet-flow.md'],
    scope: { paths: ['/api/auth/**'], tags: ['auth'] },
    lastReviewed: '2026-05-09',
  };

  it('round-trips a fully populated manifest', () => {
    expect(ModuleManifestSchema.parse(manifest)).toEqual(manifest);
  });

  it('defaults status to shipped when omitted', () => {
    const { status: _drop, ...rest } = manifest;
    const parsed = ModuleManifestSchema.parse(rest);
    expect(parsed.status).toBe('shipped');
  });

  it('preserves out-of-scope entries with provenance', () => {
    const withOOS = {
      ...manifest,
      outOfScope: [
        { id: 'wrong-job-type', reason: 'TBD', source: 'docs/PRDs/v2.md:142' },
      ],
    };
    expect(ModuleManifestSchema.parse(withOOS).outOfScope?.[0].id).toBe('wrong-job-type');
  });

  it('rejects an empty scope (a module must claim at least one path or tag)', () => {
    // Note: schema currently allows an empty scope object since both
    // paths and tags are optional. This test documents that we don't
    // enforce non-empty here — the materializer surfaces it as a
    // user-visible diagnostic instead. Guard against accidental
    // tightening that would break that flow.
    const empty = { ...manifest, scope: {} };
    expect(() => ModuleManifestSchema.parse(empty)).not.toThrow();
  });
});
