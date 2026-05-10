import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  consolidate,
  candidateFingerprint,
  discoverDocs,
  writeDecisions,
  type Block,
  type BlockRunner,
  type LlmExtraction,
  type SectionRunner,
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
 *                        flow into module.yaml.outOfScope[].
 */

const FIXTURE_ROOT = path.resolve(
  __dirname,
  '../fixtures/sample-js-project-il',
);

let workRoot: string;

beforeEach(() => {
  // Copy the fixture into a tmp dir so the consolidator can write
  // .truecourse/spec/ + .truecourse/.cache/consolidator/ without
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
 * Recursive directory copy. Skips `code/` because the consolidator
 * doesn't read it (only .md files), but we don't want the test
 * carrying around megabytes of the planted-bug tree just to test
 * the doc pipeline.
 */
function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (entry.name === 'code' || entry.name === 'node_modules' || entry.name === 'dist') continue;
    const a = path.join(src, entry.name);
    const b = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else if (entry.isFile()) fs.copyFileSync(a, b);
  }
}

// ---------------------------------------------------------------------------
// Realistic stub runner — heading-pattern-driven extractions
// ---------------------------------------------------------------------------

/**
 * Match the docs' actual headings and emit canned LlmExtractions
 * matching what a faithful LLM would return. The pattern:
 *
 *   - Headings of the form "<METHOD> /path" → endpoints claims.
 *   - "Authentication" headings → auth claims; content varies by
 *     source file (README + PRDv1 say session-cookie; PRDv2 says
 *     bearer-jwt).
 *   - "Out of Scope" → endpoints claims tagged out-of-scope.
 *   - ADR headings → claim per ADR's topic.
 *   - Everything else (Overview, Order lifecycle, narrative) emits
 *     no claims.
 */
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
              status: 'out-of-scope',
            },
            {
              topic: 'endpoints',
              subject: 'POST /api/orders/:id/refund',
              content: { method: 'POST', path: '/api/orders/:id/refund' },
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

function fixtureSectionRunner(): SectionRunner {
  return async (sections) =>
    sections.map((s) => ({
      module: s.module,
      topic: s.topic,
      fileName: s.fileName,
      markdown: `# ${s.topic} (${s.module})\n\n${s.claims.map((c) => `- ${c.subject}`).join('\n')}\n`,
      durationMs: 1,
    }));
}

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

  it('finds all 5 fixture docs (code/ has no .md)', () => {
    const docs = discoverDocs(workRoot, { skipGit: true });
    expect(docs).toHaveLength(5);
  });
});

describe('fixture: sample-js-project-il — scan mode', () => {
  it('surfaces planted conflicts (version chain + per-claim) and auto-merges agreements', async () => {
    const result = await consolidate(workRoot, {
      materialize: false,
      blockRunner: fixtureRunner(),
      skipGit: true,
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
      materialize: false,
      blockRunner: fixtureRunner(),
      skipGit: true,
    });
    const ordersConflict = result.merge.openConflicts.find(
      (c) => c.subject === 'POST /api/orders',
    )!;
    const defaultClaim = ordersConflict.candidates[ordersConflict.defaultPick].claim;
    expect(defaultClaim.provenance.file).toBe('docs/PRDs/orders_PRDv2.md');
  });
});

describe('fixture: sample-js-project-il — apply mode', () => {
  async function resolveAllOpen(): Promise<void> {
    const round1 = await consolidate(workRoot, {
      materialize: false,
      blockRunner: fixtureRunner(),
      skipGit: true,
    });
    const decisions: DecisionsFile = {
      version: 1,
      decisions: round1.merge.openConflicts.map((c) => ({
        conflictId: c.id,
        resolution: { kind: 'pick' as const, candidateIndex: c.defaultPick },
        resolvedAt: '2026-05-09T00:00:00Z',
        candidateFingerprint: candidateFingerprint(c),
      })),
    };
    writeDecisions(workRoot, decisions);
    // Re-scan: the chain decision drops PRDv1's claims, so the
    // 4-candidate auth-scheme conflict shrinks to 3 → new id (Q13).
    const round2 = await consolidate(workRoot, {
      materialize: false,
      blockRunner: fixtureRunner(),
      skipGit: true,
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
      });
    }
  }

  it('writes a canonical spec tree honoring resolved decisions', async () => {
    await resolveAllOpen();
    const apply = await consolidate(workRoot, {
      materialize: true,
      blockRunner: fixtureRunner(),
      sectionRunner: fixtureSectionRunner(),
      skipGit: true,
    });

    expect(apply.merge.openConflicts).toEqual([]);
    expect(apply.materialize?.failures).toEqual([]);

    const specRoot = path.join(workRoot, '.truecourse/spec');
    expect(fs.existsSync(path.join(specRoot, 'modules/orders/module.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(specRoot, 'modules/orders/endpoints.md'))).toBe(true);
    expect(fs.existsSync(path.join(specRoot, 'shared/auth.md'))).toBe(true);
    expect(fs.existsSync(path.join(specRoot, 'shared/errors.md'))).toBe(true);
    expect(fs.existsSync(path.join(specRoot, 'decisions.json'))).toBe(true);
  });

  it('orders manifest carries outOfScope entries (B.9 negative spec)', async () => {
    await resolveAllOpen();
    await consolidate(workRoot, {
      materialize: true,
      blockRunner: fixtureRunner(),
      sectionRunner: fixtureSectionRunner(),
      skipGit: true,
    });
    const ordersManifest = yaml.load(
      fs.readFileSync(
        path.join(workRoot, '.truecourse/spec/modules/orders/module.yaml'),
        'utf-8',
      ),
    ) as Record<string, unknown>;
    const oos = ordersManifest.outOfScope as Array<{ id: string; source: string }> | undefined;
    expect(oos).toBeDefined();
    // Slug-ifier replaces `:` with `-` (it's not allowed in the
    // [a-z0-9-/{}] charset); `:id` → `-id`.
    expect(oos!.map((e) => e.id).sort()).toEqual([
      '/api/orders/-id/refund',
      '/api/orders/-id/replace',
    ]);
    for (const e of oos!) {
      expect(e.source).toMatch(/^docs\/PRDs\/orders_PRDv2\.md:\d+$/);
    }
    const endpointsMd = fs.readFileSync(
      path.join(workRoot, '.truecourse/spec/modules/orders/endpoints.md'),
      'utf-8',
    );
    expect(endpointsMd).not.toContain('refund');
    expect(endpointsMd).not.toContain('replace');
  });

  it('orders manifest sourceDocs reflects the picked source after chain resolution', async () => {
    await resolveAllOpen();
    await consolidate(workRoot, {
      materialize: true,
      blockRunner: fixtureRunner(),
      sectionRunner: fixtureSectionRunner(),
      skipGit: true,
    });
    const ordersManifest = yaml.load(
      fs.readFileSync(
        path.join(workRoot, '.truecourse/spec/modules/orders/module.yaml'),
        'utf-8',
      ),
    ) as Record<string, unknown>;
    expect(ordersManifest.sourceDocs).toEqual(['docs/PRDs/orders_PRDv2.md']);
  });

  it('caches stay warm: re-running the same step makes zero LLM calls', async () => {
    let blockCalls = 0;
    let sectionCalls = 0;
    const countingBlock: BlockRunner = async (blocks) => {
      blockCalls += blocks.length;
      return fixtureRunner()(blocks);
    };
    const countingSection: SectionRunner = async (sections) => {
      sectionCalls += sections.length;
      return fixtureSectionRunner()(sections);
    };

    const firstScan = await consolidate(workRoot, {
      materialize: false,
      blockRunner: countingBlock,
      skipGit: true,
    });
    expect(blockCalls).toBeGreaterThan(0);

    blockCalls = 0;
    await consolidate(workRoot, {
      materialize: false,
      blockRunner: countingBlock,
      skipGit: true,
    });
    expect(blockCalls).toBe(0);

    writeDecisions(workRoot, {
      version: 1,
      decisions: firstScan.merge.openConflicts.map((c) => ({
        conflictId: c.id,
        resolution: { kind: 'pick' as const, candidateIndex: c.defaultPick },
        resolvedAt: '2026-05-09T00:00:00Z',
        candidateFingerprint: candidateFingerprint(c),
      })),
    });

    sectionCalls = 0;
    await consolidate(workRoot, {
      materialize: true,
      blockRunner: countingBlock,
      sectionRunner: countingSection,
      skipGit: true,
    });
    expect(sectionCalls).toBeGreaterThan(0);

    sectionCalls = 0;
    await consolidate(workRoot, {
      materialize: true,
      blockRunner: countingBlock,
      sectionRunner: countingSection,
      skipGit: true,
    });
    expect(sectionCalls).toBe(0);
  });
});
