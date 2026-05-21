import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  consolidate,
  readDecisions,
  writeDecisions,
  candidateFingerprint,
  type BlockRunner,
  type SectionRunner,
  type DecisionsFile,
  type LlmExtraction,
} from '../../packages/spec-consolidator/src/index.js';

/**
 * End-to-end orchestrator tests. Both runners are stubbed so the
 * suite is deterministic and free of LLM cost. The fixture is a
 * mini multi-doc layout that exercises:
 *
 *   - discovery picking up multiple docs
 *   - per-block extraction populating Claims
 *   - merge collapsing duplicates
 *   - merge surfacing a real conflict (two PRDs disagreeing)
 *   - decisions.json gating which content lands in canonical
 *   - module detection grouping endpoints under a name
 *   - materialization writing the expected file tree
 *   - cache hits on a second run
 */

let repo: string;

beforeEach(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-orch-'));
});

afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true });
});

function place(rel: string, body: string): void {
  const full = path.join(repo, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

/** A scripted block runner: callers supply per-block-subject responses. */
function blockRunner(reply: (block: import('../../packages/spec-consolidator/src/index.js').Block) => LlmExtraction): BlockRunner {
  return async (blocks) =>
    blocks.map((block) => ({
      block,
      extraction: reply(block),
      durationMs: 1,
    }));
}

/** Echo-style section runner — produces deterministic markdown the test asserts on. */
function sectionRunner(): SectionRunner {
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
// Fixture builder — a Compliance-shaped mini repo
// ---------------------------------------------------------------------------

function buildMiniRepo(): void {
  // PRD v1 — older, lists /api/v1/orders with a 200 response.
  place(
    'docs/PRDs/backend_PRDv1.md',
    [
      '# Backend PRD v1',
      '## API Endpoints',
      '',
      '### POST /api/v1/orders',
      'Create an order. Returns 200 OK.',
      '',
      '### GET /health',
      'Health check.',
    ].join('\n'),
  );
  // PRD v2 — newer, says /api/v1/orders returns 201 (the conflict).
  place(
    'docs/PRDs/backend_PRDv2.md',
    [
      '# Backend PRD v2',
      '## API Endpoints',
      '',
      '### POST /api/v1/orders',
      'Create an order. Returns 201 Created.',
      '',
      '### GET /health',
      'Health check.',
    ].join('\n'),
  );
  // Pin mtimes deterministically so the merger's "newest doc wins"
  // default-pick is stable across runs. Without this, files written
  // milliseconds apart tie at ms precision and the sort tiebreaks by
  // claim id (essentially random per-claim).
  fs.utimesSync(path.join(repo, 'docs/PRDs/backend_PRDv1.md'), new Date(OLDER), new Date(OLDER));
  fs.utimesSync(path.join(repo, 'docs/PRDs/backend_PRDv2.md'), new Date(NEWER), new Date(NEWER));
}

const NEWER = '2026-04-01T00:00:00Z';
const OLDER = '2025-01-01T00:00:00Z';

function makeRunner(): BlockRunner {
  // Reply varies by file path so v1 and v2 produce different content
  // for the same subject — that's the conflict the merger should
  // catch.
  return blockRunner((block) => {
    if (block.headingPath.at(-1) === 'POST /api/v1/orders') {
      const response = block.filePath.includes('PRDv2.md') ? '201' : '200';
      return {
        topics: ['endpoints'],
        claims: [
          {
            topic: 'endpoints',
            subject: 'POST /api/v1/orders',
            content: { method: 'POST', path: '/api/v1/orders', responses: { [response]: {} } },
            kind: 'definition',
          },
        ],
      };
    }
    if (block.headingPath.at(-1) === 'GET /health') {
      return {
        topics: ['endpoints'],
        claims: [
          {
            topic: 'endpoints',
            subject: 'GET /health',
            content: { method: 'GET', path: '/health' },
            kind: 'definition',
          },
        ],
      };
    }
    return { topics: [], claims: [] };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('consolidate — scan mode', () => {
  it('returns conflicts but does not write the canonical spec', async () => {
    buildMiniRepo();
    const result = await consolidate(repo, {
      materialize: false,
      blockRunner: makeRunner(),
      skipGit: true,
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });

    // Two conflicts now: the version chain (filename-detected
    // PRDv1 → PRDv2) and the orders content conflict (200 vs 201).
    // /health agrees across both PRDs → auto-merged.
    expect(result.merge.openConflicts).toHaveLength(2);
    const subjects = result.merge.openConflicts.map((c) => c.subject).sort();
    expect(subjects).toContain('POST /api/v1/orders');
    expect(subjects.some((s) => s.startsWith('version chain:'))).toBe(true);

    expect(result.merge.resolvedClaims.some((c) => c.subject === 'GET /health')).toBe(true);
    // No canonical spec written.
    expect(fs.existsSync(path.join(repo, '.truecourse/specs/modules'))).toBe(false);
  });
});

describe('consolidate — apply mode', () => {
  it('writes the canonical spec file tree honoring decisions.json', async () => {
    buildMiniRepo();

    // First run: scan to discover the conflict ids.
    const scan = await consolidate(repo, {
      materialize: false,
      blockRunner: makeRunner(),
      skipGit: true,
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
    // Resolve every open conflict to its default pick. The chain
    // resolution (v2 supersedes v1) makes the content conflict
    // disappear because v1's claims are dropped before merging.
    const decisions: DecisionsFile = {
      version: 1,
      decisions: scan.merge.openConflicts.map((c) => ({
        conflictId: c.id,
        resolution: { kind: 'pick', candidateIndex: c.defaultPick },
        resolvedAt: '2026-05-01T00:00:00Z',
        candidateFingerprint: candidateFingerprint(c),
      })),
    };
    writeDecisions(repo, decisions);

    // Second run: apply mode.
    const apply = await consolidate(repo, {
      materialize: true,
      blockRunner: makeRunner(),
      sectionRunner: sectionRunner(),
      skipGit: true,
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });

    expect(apply.merge.openConflicts).toEqual([]);
    expect(apply.materialize?.failures).toEqual([]);

    // Canonical spec landed.
    expect(fs.existsSync(path.join(repo, '.truecourse/specs/modules/orders/module.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(repo, '.truecourse/specs/modules/orders/endpoints.md'))).toBe(true);
    expect(fs.existsSync(path.join(repo, '.truecourse/specs/modules/health/module.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(repo, '.truecourse/specs/modules/health/endpoints.md'))).toBe(true);

    // With the chain resolved (v2 wins), v1's claims are dropped
    // before merge. Both modules' manifests reflect v2 only.
    const ordersManifest = yaml.load(
      fs.readFileSync(path.join(repo, '.truecourse/specs/modules/orders/module.yaml'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(ordersManifest.name).toBe('orders');
    expect(ordersManifest.sourceDocs).toEqual(['docs/PRDs/backend_PRDv2.md']);

    const healthManifest = yaml.load(
      fs.readFileSync(path.join(repo, '.truecourse/specs/modules/health/module.yaml'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(healthManifest.sourceDocs).toEqual(['docs/PRDs/backend_PRDv2.md']);

    // The orders endpoint section's content reflects what the section
    // runner was given — and the merger fed it the picked v2 claim.
    const md = fs.readFileSync(
      path.join(repo, '.truecourse/specs/modules/orders/endpoints.md'),
      'utf-8',
    );
    expect(md).toContain('POST /api/v1/orders');

    // decisions.json mirrored into the spec tree.
    expect(fs.existsSync(path.join(repo, '.truecourse/specs/decisions.json'))).toBe(true);
  });
});

describe('consolidate — caching', () => {
  it('on a second scan, every block is a cache hit (zero extra LLM calls)', async () => {
    buildMiniRepo();

    let calls = 0;
    const countingRunner: BlockRunner = async (blocks) => {
      calls += blocks.length;
      return makeRunner()(blocks);
    };

    await consolidate(repo, {
      materialize: false,
      blockRunner: countingRunner,
      skipGit: true,
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
    const firstRunCalls = calls;
    expect(firstRunCalls).toBeGreaterThan(0);

    // Second run hits the cache for every block.
    calls = 0;
    await consolidate(repo, {
      materialize: false,
      blockRunner: countingRunner,
      skipGit: true,
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
    expect(calls).toBe(0);
  });

  it('on a second apply, every section is a cache hit', async () => {
    buildMiniRepo();

    // First scan to surface the conflict and resolve it.
    const scan = await consolidate(repo, {
      materialize: false,
      blockRunner: makeRunner(),
      skipGit: true,
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
    const conflict = scan.merge.openConflicts[0];
    writeDecisions(repo, {
      version: 1,
      decisions: [{
        conflictId: conflict.id,
        resolution: { kind: 'pick', candidateIndex: conflict.defaultPick },
        resolvedAt: '2026-05-01T00:00:00Z',
        candidateFingerprint: candidateFingerprint(conflict),
      }],
    });

    let sectionCalls = 0;
    const countingSection: SectionRunner = async (sections) => {
      sectionCalls += sections.length;
      return sectionRunner()(sections);
    };

    await consolidate(repo, {
      materialize: true,
      blockRunner: makeRunner(),
      sectionRunner: countingSection,
      skipGit: true,
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
    const firstApplyCalls = sectionCalls;
    expect(firstApplyCalls).toBeGreaterThan(0);

    // Second apply with the same inputs — section cache hits everywhere.
    sectionCalls = 0;
    await consolidate(repo, {
      materialize: true,
      blockRunner: makeRunner(),
      sectionRunner: countingSection,
      skipGit: true,
      disableLlmChainDetection: true, disableChainRecheck: true, disableConflictExplanations: true,    });
    expect(sectionCalls).toBe(0);
  });

  it('editing a doc invalidates only that doc\'s blocks', async () => {
    buildMiniRepo();
    let calls = 0;
    const counting: BlockRunner = async (blocks) => {
      calls += blocks.length;
      return makeRunner()(blocks);
    };
    await consolidate(repo, { materialize: false, blockRunner: counting, skipGit: true });
    const baseline = calls;

    // Edit only PRDv2 — PRDv1 blocks should still be cached.
    const v2 = path.join(repo, 'docs/PRDs/backend_PRDv2.md');
    fs.writeFileSync(v2, fs.readFileSync(v2, 'utf-8') + '\n\n## Appendix\nNew note.\n');

    calls = 0;
    await consolidate(repo, { materialize: false, blockRunner: counting, skipGit: true });
    // Some calls (the changed blocks) but strictly fewer than baseline.
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThan(baseline);
  });
});

describe('readDecisions / writeDecisions', () => {
  it('returns empty default when decisions.json is missing', () => {
    expect(readDecisions(repo)).toEqual({ version: 1, decisions: [], manualChains: [] });
  });

  it('round-trips a written decisions file', () => {
    const decisions: DecisionsFile = {
      version: 1,
      decisions: [{
        conflictId: 'c-1',
        resolution: { kind: 'pick', candidateIndex: 0 },
        resolvedAt: '2026-05-01T00:00:00Z',
        candidateFingerprint: 'fp',
      }],
      manualChains: [],
    };
    writeDecisions(repo, decisions);
    expect(readDecisions(repo)).toEqual(decisions);
  });

  it('returns empty default when decisions.json is corrupt (no crash on stale state)', () => {
    const decFile = path.join(repo, '.truecourse/specs/decisions.json');
    fs.mkdirSync(path.dirname(decFile), { recursive: true });
    fs.writeFileSync(decFile, '{ corrupt');
    expect(readDecisions(repo)).toEqual({ version: 1, decisions: [], manualChains: [] });
  });
});
