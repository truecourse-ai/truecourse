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
 * canonical reference would otherwise be overwritten by the
 * materializer when the test runs `apply`), `code/` (planted-bug
 * tree, irrelevant to doc pipeline), and the usual build dirs.
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

function listSubdirs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);
}

function listFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => e.name);
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

  it('finds the docs/ + README + reference/ markdown set (code/ has no .md)', () => {
    const docs = discoverDocs(workRoot, { skipGit: true });
    // The fixture has docs/ (4 PRDs+ADRs), README.md (1), and
    // reference/ (the hand-written ground truth + skill/eval docs).
    // Discovery picks everything up; the consolidator's downstream
    // weighting decides what's authoritative.
    expect(docs.length).toBeGreaterThanOrEqual(5);
    const paths = docs.map((d) => d.path);
    expect(paths).toContain('README.md');
    expect(paths).toContain('docs/PRDs/orders_PRDv1.md');
    expect(paths).toContain('docs/PRDs/orders_PRDv2.md');
    expect(paths).toContain('docs/adr/0001-auth-bearer.md');
    expect(paths).toContain('docs/adr/0002-error-envelope.md');
  });
});

describe('fixture: sample-js-project-il — scan mode', () => {
  it('surfaces planted conflicts (version chain + per-claim) and auto-merges agreements', async () => {
    const result = await consolidate(workRoot, {
      materialize: false,
      blockRunner: fixtureRunner(),
      skipGit: true,
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });

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
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
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
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
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
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
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
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });

    expect(apply.merge.openConflicts).toEqual([]);
    expect(apply.materialize?.failures).toEqual([]);

    const specRoot = path.join(workRoot, '.truecourse/specs');
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
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
    const ordersManifest = yaml.load(
      fs.readFileSync(
        path.join(workRoot, '.truecourse/specs/modules/orders/module.yaml'),
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
      path.join(workRoot, '.truecourse/specs/modules/orders/endpoints.md'),
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
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
    const ordersManifest = yaml.load(
      fs.readFileSync(
        path.join(workRoot, '.truecourse/specs/modules/orders/module.yaml'),
        'utf-8',
      ),
    ) as Record<string, unknown>;
    expect(ordersManifest.sourceDocs).toEqual(['docs/PRDs/orders_PRDv2.md']);
  });

  it('produced canonical structurally matches the hand-written reference at .truecourse/specs/', async () => {
    // Same pattern as the IL coverage check: we hand-write a canonical
    // reference under FIXTURE_ROOT/.truecourse/specs/ describing what
    // `spec apply` *should* produce on this fixture. The materializer's
    // output is fuzzed by the LLM section runner (prose), but the
    // structural pieces — module dirs, manifest shape, file presence
    // — are deterministic. Compare those.
    await resolveAllOpen();
    await consolidate(workRoot, {
      materialize: true,
      blockRunner: fixtureRunner(),
      sectionRunner: fixtureSectionRunner(),
      skipGit: true,
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });

    const expectedRoot = path.join(FIXTURE_ROOT, '.truecourse/specs');
    const actualRoot = path.join(workRoot, '.truecourse/specs');

    // The hand-written canonical represents a fully-extracted ideal
    // (every section the docs describe). The stub runner emits claims
    // for a subset (orders only — not customers/entities/etc.) to
    // keep tests fast. So we assert a SUBSET relationship: every
    // module the consolidator produced must exist in the hand-written
    // reference and match structurally.
    const expectedModules = listSubdirs(path.join(expectedRoot, 'modules'));
    const actualModules = listSubdirs(path.join(actualRoot, 'modules'));
    for (const m of actualModules) {
      expect(
        expectedModules.includes(m),
        `module "${m}" produced by consolidator is missing from hand-written reference`,
      ).toBe(true);
    }

    // Each produced module's manifest matches the reference structurally
    // — same name, status, scope.paths set, and outOfScope id set.
    // sourceDocs is intentionally not compared because it depends on
    // which decisions were resolved and the consolidator's mtime sort
    // can produce a different (but equivalent) doc set than the
    // hand-written intent.
    for (const moduleName of actualModules) {
      const expectedYaml = yaml.load(
        fs.readFileSync(path.join(expectedRoot, 'modules', moduleName, 'module.yaml'), 'utf-8'),
      ) as Record<string, unknown>;
      const actualYaml = yaml.load(
        fs.readFileSync(path.join(actualRoot, 'modules', moduleName, 'module.yaml'), 'utf-8'),
      ) as Record<string, unknown>;
      expect(actualYaml.name, `module ${moduleName} name`).toBe(expectedYaml.name);
      expect(actualYaml.status, `module ${moduleName} status`).toBe(expectedYaml.status);
      const expectedPaths = ((expectedYaml.scope as { paths?: string[] }).paths ?? []).sort();
      const actualPaths = ((actualYaml.scope as { paths?: string[] }).paths ?? []).sort();
      expect(actualPaths, `module ${moduleName} scope.paths`).toEqual(expectedPaths);
      const expectedOos = ((expectedYaml.outOfScope as Array<{ id: string }> | undefined) ?? [])
        .map((e) => e.id)
        .sort();
      const actualOos = ((actualYaml.outOfScope as Array<{ id: string }> | undefined) ?? [])
        .map((e) => e.id)
        .sort();
      expect(actualOos, `module ${moduleName} outOfScope ids`).toEqual(expectedOos);
    }

    // shared/ files: the hand-written reference has more topic files
    // (auth, errors, endpoints) than the stub runner produces, since
    // our stub only emits auth + errors claims. Assert the materializer
    // wrote at least the topics our stub produced — full LLM coverage
    // is out of scope for the structural check.
    const expectedSharedFiles = listFiles(path.join(expectedRoot, 'shared'));
    const actualSharedFiles = listFiles(path.join(actualRoot, 'shared'));
    for (const f of actualSharedFiles) {
      expect(
        expectedSharedFiles.includes(f),
        `shared/${f} produced but not in hand-written reference`,
      ).toBe(true);
    }
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
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
    expect(blockCalls).toBeGreaterThan(0);

    blockCalls = 0;
    await consolidate(workRoot, {
      materialize: false,
      blockRunner: countingBlock,
      skipGit: true,
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
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
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
    expect(sectionCalls).toBeGreaterThan(0);

    sectionCalls = 0;
    await consolidate(workRoot, {
      materialize: true,
      blockRunner: countingBlock,
      sectionRunner: countingSection,
      skipGit: true,
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
    expect(sectionCalls).toBe(0);
  });
});
