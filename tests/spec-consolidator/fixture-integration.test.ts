import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  consolidate,
  candidateFingerprint,
  discoverDocs,
  readClaims,
  writeDecisions,
  type Block,
  type BlockRunner,
  type LlmExtraction,
  type DecisionsFile,
} from '../../packages/spec-consolidator/src/index.js';

/**
 * End-to-end test against the unified fixture
 * `tests/fixtures/sample-js-project-il/`. The fixture is one repo
 * for the whole pipeline (consolidator → extractor → verifier) — it
 * carries multi-doc inputs (PRDv1, PRDv2, two ADRs, a README) plus
 * the planted-bug `code/` tree and hand-written `.tc` corpus.
 *
 * What this test pins (consolidator side):
 *
 *   - VERSION CHAIN     PRDv1 → PRDv2 supersede surfaces as a
 *                       single Conflict via filename heuristic AND
 *                       explicit Supersedes: header.
 *   - PER-CLAIM CONFLICT  POST /api/orders 200 vs 201;
 *                         GET /api/orders shape (cursor-or-not);
 *                         auth scheme: session-cookie vs Bearer JWT.
 *   - CROSS-DOC AGREEMENT  PRDv2 + ADR 0001 both pick Bearer JWT —
 *                          merger auto-merges, manifest sourceDocs
 *                          lists both files.
 *   - NEGATIVE SPEC      PRDv2's "Out of Scope" replace + refund
 *                        flow into module manifest.outOfScope[].
 *   - CLAIMS.JSON        after all decisions are recorded, the
 *                        consolidator writes a deterministic
 *                        structured snapshot the contract extractor
 *                        consumes directly (no markdown materialize).
 */

const FIXTURE_ROOT = path.resolve(
  __dirname,
  '../fixtures/sample-js-project-il',
);

let workRoot: string;

beforeEach(() => {
  // Copy the fixture into a tmp dir so the consolidator can write
  // .truecourse/specs/ + .truecourse/.cache/consolidator/ without
  // mutating the committed fixture.
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fix-'));
  copyDir(FIXTURE_ROOT, workRoot);
  // Pin source-doc mtimes so newest-doc-wins (Q10) is deterministic.
  pinMtime('docs/PRDs/orders_PRDv1.md', '2024-06-01T00:00:00Z');
  pinMtime('docs/PRDs/orders_PRDv2.md', '2026-04-01T00:00:00Z');
  pinMtime('docs/adr/0001-auth-bearer.md', '2026-04-15T00:00:00Z');
  pinMtime('docs/adr/0002-error-envelope.md', '2026-04-15T00:00:00Z');
  pinMtime('README.md', '2024-01-01T00:00:00Z');
});

afterEach(() => {
  fs.rmSync(workRoot, { recursive: true, force: true });
});

function pinMtime(rel: string, iso: string): void {
  const full = path.join(workRoot, rel);
  const t = new Date(iso);
  fs.utimesSync(full, t, t);
}

/**
 * Recursive directory copy. Skips `.truecourse/` (the hand-written
 * canonical reference would otherwise be overwritten when the
 * consolidator writes claims.json), `code/` (planted-bug tree,
 * irrelevant to the doc pipeline), and the usual build dirs.
 */
function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (
      entry.name === 'code' ||
      entry.name === 'node_modules' ||
      entry.name === 'dist' ||
      entry.name === '.truecourse'
    ) {
      continue;
    }
    const a = path.join(src, entry.name);
    const b = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else if (entry.isFile()) fs.copyFileSync(a, b);
  }
}

// ---------------------------------------------------------------------------
// Realistic stub runner — heading-pattern-driven extractions
// ---------------------------------------------------------------------------

function fixtureRunner(): BlockRunner {
  const reply = (block: Block): LlmExtraction => {
    const file = path.basename(block.filePath);
    const heading = block.headingPath.at(-1) ?? '';

    // README — single H1 block; carries the planted stale auth claim.
    if (file === 'README.md') {
      return {
        topics: ['auth'],
        claims: [
          {
            topic: 'auth',
            subject: 'auth scheme',
            content: { scheme: 'session-cookie', scope: '/api/**' },
            kind: 'definition',
          },
        ],
      };
    }

    // ADR 0001 — auth scheme (Bearer JWT).
    if (file === '0001-auth-bearer.md') {
      return {
        topics: ['auth'],
        claims: [
          {
            topic: 'auth',
            subject: 'auth scheme',
            content: { scheme: 'bearer-jwt', scope: '/api/**' },
            kind: 'definition',
          },
        ],
      };
    }

    // ADR 0002 — error envelope.
    if (file === '0002-error-envelope.md') {
      return {
        topics: ['errors'],
        claims: [
          {
            topic: 'errors',
            subject: 'global error envelope',
            content: { envelope: { error: { code: 'string', message: 'string' } } },
            kind: 'definition',
          },
        ],
      };
    }

    // PRDv1 endpoints.
    if (file === 'orders_PRDv1.md') {
      if (heading === 'POST /api/orders') {
        return {
          topics: ['endpoints'],
          claims: [
            {
              topic: 'endpoints',
              subject: 'POST /api/orders',
              content: {
                method: 'POST',
                path: '/api/orders',
                request: { totalCents: 'integer', customerId: 'uuid' },
                responses: { '200': { id: 'uuid', status: 'string' } },
              },
              kind: 'definition',
              status: 'shipped',
            },
          ],
        };
      }
      if (heading === 'GET /api/orders') {
        return {
          topics: ['endpoints'],
          claims: [
            {
              topic: 'endpoints',
              subject: 'GET /api/orders',
              content: {
                method: 'GET',
                path: '/api/orders',
                responses: { '200': { orders: 'Order[]' } },
              },
              kind: 'definition',
              status: 'shipped',
            },
          ],
        };
      }
      if (heading === 'Authentication') {
        return {
          topics: ['auth'],
          claims: [
            {
              topic: 'auth',
              subject: 'auth scheme',
              content: { scheme: 'session-cookie', scope: '/api/**' },
              kind: 'definition',
            },
          ],
        };
      }
    }

    // PRDv2 — the comprehensive current spec.
    if (file === 'orders_PRDv2.md') {
      if (heading === 'POST /api/orders') {
        return {
          topics: ['endpoints'],
          claims: [
            {
              topic: 'endpoints',
              subject: 'POST /api/orders',
              content: {
                method: 'POST',
                path: '/api/orders',
                request: { totalCents: 'integer', customerId: 'uuid' },
                responses: {
                  '201': {
                    id: 'uuid',
                    status: 'string',
                    placedAt: 'ISO',
                    updatedAt: 'ISO',
                  },
                },
              },
              kind: 'definition',
              status: 'shipped',
            },
          ],
        };
      }
      if (heading === 'GET /api/orders') {
        return {
          topics: ['endpoints'],
          claims: [
            {
              topic: 'endpoints',
              subject: 'GET /api/orders',
              content: {
                method: 'GET',
                path: '/api/orders',
                responses: {
                  '200': { items: 'Order[]', nextCursor: 'string|null' },
                },
              },
              kind: 'definition',
              status: 'shipped',
            },
          ],
        };
      }
      if (heading === 'Authentication') {
        return {
          topics: ['auth'],
          claims: [
            {
              topic: 'auth',
              subject: 'auth scheme',
              content: { scheme: 'bearer-jwt', scope: '/api/**' },
              kind: 'definition',
            },
          ],
        };
      }
      if (heading === 'Out of Scope') {
        return {
          topics: ['endpoints'],
          claims: [
            {
              topic: 'endpoints',
              subject: 'POST /api/orders/:id/replace',
              content: { method: 'POST', path: '/api/orders/:id/replace' },
              kind: 'definition',
              status: 'out-of-scope',
            },
            {
              topic: 'endpoints',
              subject: 'POST /api/orders/:id/refund',
              content: { method: 'POST', path: '/api/orders/:id/refund' },
              kind: 'definition',
              status: 'out-of-scope',
            },
          ],
        };
      }
    }

    // Narrative / unrecognized blocks emit nothing.
    return { topics: [], claims: [] };
  };

  return async (blocks) =>
    blocks.map((block) => ({
      block,
      extraction: reply(block),
      durationMs: 1,
    }));
}

const PIPELINE_OFF = {
  disableLlmChainDetection: true,
  disableChainRecheck: true,
  disableConflictExplanations: true,
  disableConflictResolution: true,
  disableRelevanceFilter: true,
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fixture: sample-js-project-il — discovery', () => {
  it('classifies every doc with the right kind', () => {
    const docs = discoverDocs(workRoot, { skipGit: true });
    const map = new Map(docs.map((d) => [d.path, d.kind]));
    expect(map.get('README.md')).toBe('readme');
    expect(map.get('docs/PRDs/orders_PRDv1.md')).toBe('prd');
    expect(map.get('docs/PRDs/orders_PRDv2.md')).toBe('prd');
    expect(map.get('docs/adr/0001-auth-bearer.md')).toBe('adr');
    expect(map.get('docs/adr/0002-error-envelope.md')).toBe('adr');
  });

  it('finds the docs/ + README + reference/ markdown set (code/ has no .md)', () => {
    const docs = discoverDocs(workRoot, { skipGit: true });
    expect(docs.length).toBeGreaterThanOrEqual(5);
    const paths = docs.map((d) => d.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('docs/PRDs/orders_PRDv1.md');
    expect(paths).toContain('docs/PRDs/orders_PRDv2.md');
    expect(paths).toContain('docs/adr/0001-auth-bearer.md');
    expect(paths).toContain('docs/adr/0002-error-envelope.md');
  });
});

describe('fixture: sample-js-project-il — scan', () => {
  it('surfaces planted conflicts (version chain + per-claim) and auto-merges agreements', async () => {
    const result = await consolidate(workRoot, {
      blockRunner: fixtureRunner(),
      skipGit: true,
      ...PIPELINE_OFF,
    });

    const subjects = result.merge.openConflicts.map((c) => c.subject).sort();
    // Expect: chain conflict (B.8) + 3 content conflicts.
    expect(subjects).toContain('GET /api/orders');
    expect(subjects).toContain('POST /api/orders');
    expect(subjects).toContain('auth scheme');
    expect(subjects.some((s) => s.startsWith('version chain:'))).toBe(true);
  });

  it('default-picks the newest source for content conflicts (Q10)', async () => {
    const result = await consolidate(workRoot, {
      blockRunner: fixtureRunner(),
      skipGit: true,
      ...PIPELINE_OFF,
    });
    const ordersConflict = result.merge.openConflicts.find(
      (c) => c.subject === 'POST /api/orders',
    )!;
    const defaultClaim = ordersConflict.candidates[ordersConflict.defaultPick].claim;
    expect(defaultClaim.provenance.file).toBe('docs/PRDs/orders_PRDv2.md');
  });
});

describe('fixture: sample-js-project-il — claims.json', () => {
  async function resolveAllOpen(): Promise<void> {
    const round1 = await consolidate(workRoot, {
      blockRunner: fixtureRunner(),
      skipGit: true,
      ...PIPELINE_OFF,
    });
    const decisions: DecisionsFile = {
      version: 1,
      decisions: round1.merge.openConflicts.map((c) => ({
        conflictId: c.id,
        resolution: { kind: 'pick' as const, candidateIndex: c.defaultPick },
        resolvedAt: '2026-05-09T00:00:00Z',
        candidateFingerprint: candidateFingerprint(c),
      })),
      manualChains: [],
      manualIncludes: [],
    };
    writeDecisions(workRoot, decisions);
    // Re-scan: the chain decision drops PRDv1's claims, so the
    // 4-candidate auth-scheme conflict shrinks to 3 → new id (Q13).
    const round2 = await consolidate(workRoot, {
      blockRunner: fixtureRunner(),
      skipGit: true,
      ...PIPELINE_OFF,
    });
    if (round2.merge.openConflicts.length > 0) {
      writeDecisions(workRoot, {
        version: 1,
        decisions: [
          ...decisions.decisions,
          ...round2.merge.openConflicts.map((c) => ({
            conflictId: c.id,
            resolution: { kind: 'pick' as const, candidateIndex: c.defaultPick },
            resolvedAt: '2026-05-09T00:00:00Z',
            candidateFingerprint: candidateFingerprint(c),
          })),
        ],
        manualChains: [],
        manualIncludes: [],
      });
    }
  }

  it('writes claims.json carrying resolved claims grouped by module', async () => {
    await resolveAllOpen();
    const final = await consolidate(workRoot, {
      blockRunner: fixtureRunner(),
      skipGit: true,
      ...PIPELINE_OFF,
    });

    expect(final.merge.openConflicts).toEqual([]);

    const claimsFile = path.join(workRoot, '.truecourse/specs/claims.json');
    expect(fs.existsSync(claimsFile)).toBe(true);
    const claims = readClaims(workRoot);
    expect(claims).not.toBeNull();
    // Orders module owns the POST/GET endpoints.
    const ordersClaims = claims!.claims.filter((c) => c.module === 'orders');
    expect(ordersClaims.some((c) => c.subject === 'POST /api/orders')).toBe(true);
    expect(ordersClaims.some((c) => c.subject === 'GET /api/orders')).toBe(true);
    // Out-of-scope claims are filtered from claims[] but preserved on
    // the module manifest's outOfScope[].
    expect(ordersClaims.some((c) => c.subject === 'POST /api/orders/:id/replace')).toBe(false);
    // _shared module owns auth + errors.
    const sharedClaims = claims!.claims.filter((c) => c.module === '_shared');
    expect(sharedClaims.some((c) => c.subject === 'auth scheme')).toBe(true);
    expect(sharedClaims.some((c) => c.subject === 'global error envelope')).toBe(true);
  });

  it('orders manifest carries outOfScope entries (B.9 negative spec)', async () => {
    await resolveAllOpen();
    await consolidate(workRoot, {
      blockRunner: fixtureRunner(),
      skipGit: true,
      ...PIPELINE_OFF,
    });
    const claims = readClaims(workRoot);
    const ordersModule = claims!.modules.find((m) => m.name === 'orders');
    expect(ordersModule).toBeDefined();
    const oos = ordersModule!.outOfScope ?? [];
    expect(oos.map((e) => e.id).sort()).toEqual([
      '/api/orders/-id/refund',
      '/api/orders/-id/replace',
    ]);
    for (const e of oos) {
      expect(e.source).toMatch(/^docs\/PRDs\/orders_PRDv2\.md:\d+$/);
    }
  });

  it('orders manifest sourceDocs reflects the picked source after chain resolution', async () => {
    await resolveAllOpen();
    await consolidate(workRoot, {
      blockRunner: fixtureRunner(),
      skipGit: true,
      ...PIPELINE_OFF,
    });
    const claims = readClaims(workRoot);
    const ordersModule = claims!.modules.find((m) => m.name === 'orders');
    expect(ordersModule?.sourceDocs).toEqual(['docs/PRDs/orders_PRDv2.md']);
  });

  it('caches stay warm: re-running scan after a fresh write makes zero LLM calls', async () => {
    let blockCalls = 0;
    const countingBlock: BlockRunner = async (blocks) => {
      blockCalls += blocks.length;
      return fixtureRunner()(blocks);
    };

    await consolidate(workRoot, {
      blockRunner: countingBlock,
      skipGit: true,
      ...PIPELINE_OFF,
    });
    expect(blockCalls).toBeGreaterThan(0);

    blockCalls = 0;
    await consolidate(workRoot, {
      blockRunner: countingBlock,
      skipGit: true,
      ...PIPELINE_OFF,
    });
    expect(blockCalls).toBe(0);
  });
});
