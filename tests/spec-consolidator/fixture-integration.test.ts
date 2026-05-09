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
 * End-to-end test against the internal fixture
 * `tests/fixtures/sample-multi-doc-spec/`. The fixture has six
 * markdown docs of different kinds (PRDv1, PRDv2, two ADRs, a
 * README, design notes, a runbook) carrying planted patterns the
 * consolidator must surface:
 *
 *   - VERSION CHAIN     PRDv1 → PRDv2 supersede (covered by B.8 later;
 *                       for now both contribute to the conflict set).
 *   - PER-CLAIM CONFLICT  POST /api/v1/orders 200 vs 201
 *                       GET  /api/v1/orders shape (with/without nextCursor)
 *                       Auth scheme: session-cookie vs Bearer JWT
 *   - CROSS-DOC AGREEMENT JWT auth in PRDv2 + ADR0001 — same content,
 *                       merger auto-merges, manifest sourceDocs lists both.
 *   - PHASE STATUS      POST /orders/{id}/refund tagged "Phase 2" →
 *                       extracted as status: planned.
 *   - NEGATIVE SPEC     "Out of Scope" cancel + replace endpoints —
 *                       extracted as status: out-of-scope (B.9 surfaces
 *                       these structurally on the manifest later).
 *
 * The fixture is the test target; the test wires a deterministic
 * stub runner that maps each (file, headingPath) to a canned
 * LlmExtraction matching what a faithful LLM would return.
 */

const FIXTURE_ROOT = path.resolve(
  __dirname,
  '../fixtures/sample-multi-doc-spec',
);

let workRoot: string;

beforeEach(() => {
  // Copy the fixture into a tmp dir so the consolidator can write
  // .truecourse/spec/ + .truecourse/.cache/consolidator/ without
  // mutating the committed fixture.
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-fix-'));
  copyDir(FIXTURE_ROOT, workRoot);
  // Pin source-doc mtimes so newest-doc-wins (Q10) is deterministic.
  fs.utimesSync(
    path.join(workRoot, 'docs/PRDs/backend_PRDv1.md'),
    new Date('2024-06-01T00:00:00Z'),
    new Date('2024-06-01T00:00:00Z'),
  );
  fs.utimesSync(
    path.join(workRoot, 'docs/PRDs/backend_PRDv2.md'),
    new Date('2026-04-01T00:00:00Z'),
    new Date('2026-04-01T00:00:00Z'),
  );
  fs.utimesSync(
    path.join(workRoot, 'docs/adr/0001-auth-scheme.md'),
    new Date('2026-04-15T00:00:00Z'),
    new Date('2026-04-15T00:00:00Z'),
  );
  fs.utimesSync(
    path.join(workRoot, 'docs/adr/0002-error-envelope.md'),
    new Date('2026-04-15T00:00:00Z'),
    new Date('2026-04-15T00:00:00Z'),
  );
  fs.utimesSync(
    path.join(workRoot, 'README.md'),
    new Date('2024-01-01T00:00:00Z'),
    new Date('2024-01-01T00:00:00Z'),
  );
});

afterEach(() => {
  fs.rmSync(workRoot, { recursive: true, force: true });
});

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const a = path.join(src, entry.name);
    const b = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else if (entry.isFile()) fs.copyFileSync(a, b);
  }
}

// ---------------------------------------------------------------------------
// Realistic stub runner — hard-coded extractions per block
// ---------------------------------------------------------------------------

/**
 * Look up the canned extraction for a block by (file, last heading
 * segment). Returns an empty extraction when the block has no
 * extractable claims (pure narrative).
 */
function fixtureRunner(): BlockRunner {
  const reply = (block: Block): LlmExtraction => {
    const file = path.basename(block.filePath);
    const heading = block.headingPath.at(-1) ?? '';

    // README — the planted-stale auth claim.
    if (file === 'README.md' && heading === 'Sample Order Service') {
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

    // PRDv1 endpoints.
    if (file === 'backend_PRDv1.md' && heading === 'POST /api/v1/orders') {
      return {
        topics: ['endpoints'],
        claims: [
          {
            topic: 'endpoints',
            subject: 'POST /api/v1/orders',
            content: {
              method: 'POST',
              path: '/api/v1/orders',
              request: { subtotalCents: 'number', customerId: 'uuid' },
              responses: { '200': { id: 'uuid', status: 'string' } },
            },
            status: 'shipped',
          },
        ],
      };
    }
    if (file === 'backend_PRDv1.md' && heading === 'GET /api/v1/orders') {
      return {
        topics: ['endpoints'],
        claims: [
          {
            topic: 'endpoints',
            subject: 'GET /api/v1/orders',
            content: {
              method: 'GET',
              path: '/api/v1/orders',
              responses: { '200': { items: 'Order[]' } },
            },
            status: 'shipped',
          },
        ],
      };
    }
    if (file === 'backend_PRDv1.md' && heading === 'Authentication') {
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

    // PRDv2 endpoints.
    if (file === 'backend_PRDv2.md' && heading === 'POST /api/v1/orders') {
      return {
        topics: ['endpoints'],
        claims: [
          {
            topic: 'endpoints',
            subject: 'POST /api/v1/orders',
            content: {
              method: 'POST',
              path: '/api/v1/orders',
              request: { subtotalCents: 'number', customerId: 'uuid' },
              responses: { '201': { id: 'uuid', status: 'string', createdAt: 'ISO' } },
            },
            status: 'shipped',
          },
        ],
      };
    }
    if (file === 'backend_PRDv2.md' && heading === 'GET /api/v1/orders') {
      return {
        topics: ['endpoints'],
        claims: [
          {
            topic: 'endpoints',
            subject: 'GET /api/v1/orders',
            content: {
              method: 'GET',
              path: '/api/v1/orders',
              responses: { '200': { items: 'Order[]', nextCursor: 'string|null' } },
            },
            status: 'shipped',
          },
        ],
      };
    }
    if (file === 'backend_PRDv2.md' && heading === 'POST /api/v1/orders/{id}/refund') {
      return {
        topics: ['endpoints'],
        claims: [
          {
            topic: 'endpoints',
            subject: 'POST /api/v1/orders/{id}/refund',
            content: {
              method: 'POST',
              path: '/api/v1/orders/{id}/refund',
              responses: { '201': { id: 'uuid', status: 'refunded' } },
            },
            status: 'planned',
          },
        ],
      };
    }
    if (file === 'backend_PRDv2.md' && heading === 'Authentication') {
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
    if (file === 'backend_PRDv2.md' && heading === 'Out of Scope') {
      return {
        topics: ['endpoints'],
        claims: [
          {
            topic: 'endpoints',
            subject: 'POST /api/v1/orders/{id}/cancel',
            content: { method: 'POST', path: '/api/v1/orders/{id}/cancel' },
            status: 'out-of-scope',
          },
          {
            topic: 'endpoints',
            subject: 'POST /api/v1/orders/{id}/replace',
            content: { method: 'POST', path: '/api/v1/orders/{id}/replace' },
            status: 'out-of-scope',
          },
        ],
      };
    }

    // ADRs.
    if (file === '0001-auth-scheme.md' && heading === 'ADR 0001 — Authentication scheme') {
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
    if (file === '0002-error-envelope.md' && heading === 'ADR 0002 — Error response envelope') {
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

    // Narrative-only blocks emit nothing.
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

describe('fixture: sample-multi-doc-spec — discovery', () => {
  it('classifies every doc with the right kind', () => {
    const docs = discoverDocs(workRoot, { skipGit: true });
    const map = new Map(docs.map((d) => [d.path, d.kind]));
    expect(map.get('README.md')).toBe('readme');
    expect(map.get('docs/PRDs/backend_PRDv1.md')).toBe('prd');
    expect(map.get('docs/PRDs/backend_PRDv2.md')).toBe('prd');
    expect(map.get('docs/adr/0001-auth-scheme.md')).toBe('adr');
    expect(map.get('docs/adr/0002-error-envelope.md')).toBe('adr');
    expect(map.get('docs/notes/api-thoughts.md')).toBe('design-note');
    expect(map.get('docs/DEPLOYMENT.md')).toBe('runbook');
  });

  it('finds all 7 fixture docs', () => {
    const docs = discoverDocs(workRoot, { skipGit: true });
    expect(docs).toHaveLength(7);
  });
});

describe('fixture: sample-multi-doc-spec — scan mode', () => {
  it('surfaces the planted conflicts and auto-merges agreements', async () => {
    const result = await consolidate(workRoot, {
      materialize: false,
      blockRunner: fixtureRunner(),
      skipGit: true,
    });

    const conflictSubjects = result.merge.openConflicts.map((c) => c.subject).sort();
    // POST /api/v1/orders → 200 vs 201
    // GET /api/v1/orders → with/without nextCursor
    // auth scheme → 4 claims, 2 distinct contents → 1 conflict
    expect(conflictSubjects).toEqual([
      'GET /api/v1/orders',
      'POST /api/v1/orders',
      'auth scheme',
    ]);

    // Singleton claims that didn't conflict:
    const resolvedSubjects = result.merge.resolvedClaims.map((c) => c.subject).sort();
    expect(resolvedSubjects).toContain('POST /api/v1/orders/{id}/refund');
    expect(resolvedSubjects).toContain('POST /api/v1/orders/{id}/cancel');
    expect(resolvedSubjects).toContain('POST /api/v1/orders/{id}/replace');
    expect(resolvedSubjects).toContain('global error envelope');

    // Status preserved on the planned + out-of-scope claims.
    const refund = result.merge.resolvedClaims.find(
      (c) => c.subject === 'POST /api/v1/orders/{id}/refund',
    )!;
    expect(refund.metadata.status).toBe('planned');

    const cancel = result.merge.resolvedClaims.find(
      (c) => c.subject === 'POST /api/v1/orders/{id}/cancel',
    )!;
    expect(cancel.metadata.status).toBe('out-of-scope');
  });

  it('default-picks the newest source for each conflict (Q10)', async () => {
    const result = await consolidate(workRoot, {
      materialize: false,
      blockRunner: fixtureRunner(),
      skipGit: true,
    });
    // POST /api/v1/orders conflict — defaultPick should be the v2
    // claim (newer mtime).
    const ordersConflict = result.merge.openConflicts.find(
      (c) => c.subject === 'POST /api/v1/orders',
    )!;
    const defaultClaim = ordersConflict.candidates[ordersConflict.defaultPick].claim;
    expect(defaultClaim.provenance.file).toBe('docs/PRDs/backend_PRDv2.md');

    // auth-scheme conflict — defaultPick should be from ADR0001 or
    // PRDv2 (both newer than README + PRDv1). With ADR0001 mtime
    // pinned latest, it wins.
    const authConflict = result.merge.openConflicts.find(
      (c) => c.subject === 'auth scheme',
    )!;
    const authDefault = authConflict.candidates[authConflict.defaultPick].claim;
    expect(authDefault.provenance.file).toMatch(/(0001-auth-scheme|backend_PRDv2)/);
    expect((authDefault.content as { scheme: string }).scheme).toBe('bearer-jwt');
  });
});

describe('fixture: sample-multi-doc-spec — apply mode', () => {
  it('writes a canonical spec tree honoring resolved decisions', async () => {
    const scan = await consolidate(workRoot, {
      materialize: false,
      blockRunner: fixtureRunner(),
      skipGit: true,
    });
    // Resolve every open conflict to its default pick (Q7: pre-pick + accept).
    const decisions: DecisionsFile = {
      version: 1,
      decisions: scan.merge.openConflicts.map((c) => ({
        conflictId: c.id,
        resolution: { kind: 'pick', candidateIndex: c.defaultPick },
        resolvedAt: '2026-05-09T00:00:00Z',
        candidateFingerprint: candidateFingerprint(c),
      })),
    };
    writeDecisions(workRoot, decisions);

    const apply = await consolidate(workRoot, {
      materialize: true,
      blockRunner: fixtureRunner(),
      sectionRunner: fixtureSectionRunner(),
      skipGit: true,
    });

    expect(apply.merge.openConflicts).toEqual([]);
    expect(apply.materialize?.failures).toEqual([]);

    const specRoot = path.join(workRoot, '.truecourse/spec');
    // orders module — has every endpoint claim.
    expect(fs.existsSync(path.join(specRoot, 'modules/orders/module.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(specRoot, 'modules/orders/endpoints.md'))).toBe(true);

    // _shared module — auth + global error envelope.
    expect(fs.existsSync(path.join(specRoot, 'shared/auth.md'))).toBe(true);
    expect(fs.existsSync(path.join(specRoot, 'shared/errors.md'))).toBe(true);

    // decisions.json mirrored.
    expect(fs.existsSync(path.join(specRoot, 'decisions.json'))).toBe(true);
  });

  it('orders manifest sourceDocs reflects only the picked source for resolved conflicts', async () => {
    const scan = await consolidate(workRoot, {
      materialize: false,
      blockRunner: fixtureRunner(),
      skipGit: true,
    });
    // Pick all defaults — newest doc per conflict.
    const decisions: DecisionsFile = {
      version: 1,
      decisions: scan.merge.openConflicts.map((c) => ({
        conflictId: c.id,
        resolution: { kind: 'pick', candidateIndex: c.defaultPick },
        resolvedAt: '2026-05-09T00:00:00Z',
        candidateFingerprint: candidateFingerprint(c),
      })),
    };
    writeDecisions(workRoot, decisions);
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

    // Orders module: POST /orders + GET /orders both came from PRDv2
    // (the picked default). PRDv1 was rejected. Refund + cancel +
    // replace also came from PRDv2. So sourceDocs should be PRDv2 only.
    expect(ordersManifest.sourceDocs).toEqual(['docs/PRDs/backend_PRDv2.md']);
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

    // Step 1: first scan primes the block cache.
    const firstScan = await consolidate(workRoot, {
      materialize: false,
      blockRunner: countingBlock,
      skipGit: true,
    });
    expect(blockCalls).toBeGreaterThan(0);

    // Step 2: second scan with the same inputs — block cache hits everywhere.
    blockCalls = 0;
    await consolidate(workRoot, {
      materialize: false,
      blockRunner: countingBlock,
      skipGit: true,
    });
    expect(blockCalls).toBe(0);

    // Step 3: write decisions and apply for the first time. Block
    // cache is already primed; section cache is cold and fills on
    // this run.
    writeDecisions(workRoot, {
      version: 1,
      decisions: firstScan.merge.openConflicts.map((c) => ({
        conflictId: c.id,
        resolution: { kind: 'pick', candidateIndex: c.defaultPick },
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

    // Step 4: second apply — section cache now hits everywhere.
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
