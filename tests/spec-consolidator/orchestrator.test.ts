import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ClaimsFileSchema,
  consolidate,
  readClaims,
  readDecisions,
  writeDecisions,
  candidateFingerprint,
  type BlockRunner,
  type DecisionsFile,
  type LlmExtraction,
} from '../../packages/spec-consolidator/src/index.js';

/**
 * End-to-end orchestrator tests. The block runner is stubbed so the
 * suite is deterministic and free of LLM cost. The fixture is a
 * mini multi-doc layout that exercises:
 *
 *   - discovery picking up multiple docs
 *   - per-block extraction populating Claims
 *   - merge collapsing duplicates
 *   - merge surfacing a real conflict (two PRDs disagreeing)
 *   - decisions.json gating which content lands in claims.json
 *   - module detection grouping endpoints under a name
 *   - claims.json write at the end of consolidate()
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

describe('consolidate — scan', () => {
  it('returns conflicts and writes a claims.json snapshot', async () => {
    buildMiniRepo();
    const result = await consolidate(repo, {
      blockRunner: makeRunner(),
      skipGit: true,
      ...PIPELINE_OFF,
    });

    // Two conflicts now: the version chain (filename-detected
    // PRDv1 → PRDv2) and the orders content conflict (200 vs 201).
    // /health agrees across both PRDs → auto-merged.
    expect(result.merge.openConflicts).toHaveLength(2);
    const subjects = result.merge.openConflicts.map((c) => c.subject).sort();
    expect(subjects).toContain('POST /api/v1/orders');
    expect(subjects.some((s) => s.startsWith('version chain:'))).toBe(true);

    expect(result.merge.resolvedClaims.some((c) => c.subject === 'GET /health')).toBe(true);

    // claims.json was written at the canonical path.
    const claimsFile = path.join(repo, '.truecourse/specs/claims.json');
    expect(fs.existsSync(claimsFile)).toBe(true);
    const parsed = ClaimsFileSchema.parse(JSON.parse(fs.readFileSync(claimsFile, 'utf-8')));
    expect(parsed.claims.some((c) => c.subject === 'GET /health')).toBe(true);
    // The pre-resolution snapshot only carries singletons + auto-merged
    // claims; the unresolved POST conflict has no entry yet.
    expect(parsed.claims.some((c) => c.subject === 'POST /api/v1/orders')).toBe(false);
  });

  it('auto-resolves chains where every older candidate has 0 extractable claims', async () => {
    // Two PRDs: v1 is prose that yields NO claims, v2 yields one.
    // Filename versioning makes them a chain. With no claims at stake
    // on v1, the chain shouldn't block the user.
    place(
      'docs/PRDs/backend_PRDv1.md',
      ['# Backend PRD v1', '', 'Discussion-only — no extractable claims here yet.'].join('\n'),
    );
    place(
      'docs/PRDs/backend_PRDv2.md',
      [
        '# Backend PRD v2',
        '## API Endpoints',
        '',
        '### POST /api/v1/orders',
        'Create an order. Returns 201 Created.',
      ].join('\n'),
    );
    fs.utimesSync(path.join(repo, 'docs/PRDs/backend_PRDv1.md'), new Date(OLDER), new Date(OLDER));
    fs.utimesSync(path.join(repo, 'docs/PRDs/backend_PRDv2.md'), new Date(NEWER), new Date(NEWER));

    // Runner: v1 returns nothing; v2 returns the orders claim.
    const runner: BlockRunner = blockRunner((block) => {
      if (block.filePath.includes('PRDv1.md')) return { topics: [], claims: [] };
      if (block.headingPath.at(-1) === 'POST /api/v1/orders') {
        return {
          topics: ['endpoints'],
          claims: [
            {
              topic: 'endpoints',
              subject: 'POST /api/v1/orders',
              content: { method: 'POST', path: '/api/v1/orders', responses: { '201': {} } },
              kind: 'definition',
            },
          ],
        };
      }
      return { topics: [], claims: [] };
    });

    const result = await consolidate(repo, {
      blockRunner: runner,
      skipGit: true,
      ...PIPELINE_OFF,
    });

    // The chain ends up DECIDED, not open. Picking the newest is the
    // implicit decision and the note explains why.
    expect(result.merge.openConflicts.some((c) => c.subject.startsWith('version chain:'))).toBe(false);
    const decidedChain = result.merge.decidedConflicts.find((d) =>
      d.conflict.subject.startsWith('version chain:'),
    );
    expect(decidedChain).toBeDefined();
    expect(decidedChain?.decision.resolution).toEqual({
      kind: 'pick',
      candidateIndex: decidedChain!.conflict.candidates.length - 1,
    });
    expect(decidedChain?.decision.candidateFingerprint).toBe('auto-zero-claim-chain');
    expect(decidedChain?.decision.note).toMatch(/no extractable claims/i);
  });
});

describe('consolidate — LLM conflict resolver', () => {
  it('auto-applies high-confidence resolutions and leaves low-confidence open', async () => {
    buildMiniRepo();
    // Custom resolver: returns 'high' on the orders conflict, 'low' on
    // the version-chain (so the chain stays open with reasoning).
    const resolverRunner: import('../../packages/spec-consolidator/src/index.js').ConflictResolverRunner = async ({ conflict }) => {
      if (conflict.subject.startsWith('version chain:')) {
        return { pick: conflict.defaultPick, confidence: 'low', reasoning: 'true trade-off; needs human' };
      }
      return { pick: 1, confidence: 'high', reasoning: 'PRDv2 reflects the shipped 201 response' };
    };

    const result = await consolidate(repo, {
      blockRunner: makeRunner(),
      skipGit: true,
      disableLlmChainDetection: true,
      disableChainRecheck: true,
      disableConflictExplanations: true,
      disableRelevanceFilter: true,
      conflictResolverRunner: resolverRunner,
    });

    // The orders content conflict got auto-resolved → moved to decided.
    const ordersDecided = result.merge.decidedConflicts.find(
      (d) => d.conflict.subject === 'POST /api/v1/orders',
    );
    expect(ordersDecided).toBeDefined();
    expect(ordersDecided?.decision.candidateFingerprint).toBe('auto-llm-resolve');
    expect(ordersDecided?.decision.resolution).toEqual({ kind: 'pick', candidateIndex: 1 });
    expect(ordersDecided?.autoResolution).toEqual({
      by: 'llm',
      confidence: 'high',
      reasoning: 'PRDv2 reflects the shipped 201 response',
    });

    // The chain conflict stayed open, with the resolver's reasoning
    // REPLACING the explainer text (medium/low confidence path).
    const chainOpen = result.merge.openConflicts.find((c) => c.subject.startsWith('version chain:'));
    expect(chainOpen).toBeDefined();
    expect(chainOpen?.explanation).toBe('true trade-off; needs human');
    expect(chainOpen?.resolverVerdict).toEqual({
      confidence: 'low',
      reasoning: 'true trade-off; needs human',
      pick: chainOpen!.defaultPick,
    });
  });

  it('falls back to defaultPick + low confidence when the resolver returns an out-of-range pick', async () => {
    buildMiniRepo();
    const resolverRunner: import('../../packages/spec-consolidator/src/index.js').ConflictResolverRunner = async () => ({
      pick: 99,
      confidence: 'high',
      reasoning: 'invalid',
    });
    const result = await consolidate(repo, {
      blockRunner: makeRunner(),
      skipGit: true,
      disableLlmChainDetection: true,
      disableChainRecheck: true,
      disableConflictExplanations: true,
      disableRelevanceFilter: true,
      conflictResolverRunner: resolverRunner,
    });
    // Out-of-range pick is sanitized to defaultPick + low confidence
    // → stays open (low never auto-applies), reasoning surfaces in the
    // replaced explanation and on the structured verdict.
    const orders = result.merge.openConflicts.find((c) => c.subject === 'POST /api/v1/orders');
    expect(orders).toBeDefined();
    expect(orders?.explanation ?? '').toMatch(/out-of-range/);
    expect(orders?.resolverVerdict?.confidence).toBe('low');
  });
});

describe('consolidate — claims.json after decisions', () => {
  it('embeds resolved + decided picks (and drops superseded sources)', async () => {
    buildMiniRepo();

    // First scan to discover the conflict ids.
    const scan = await consolidate(repo, {
      blockRunner: makeRunner(),
      skipGit: true,
      ...PIPELINE_OFF,
    });
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
      manualChains: [],
      manualIncludes: [],
    };
    writeDecisions(repo, decisions);

    // Second run: same orchestrator, now with decisions on disk.
    const second = await consolidate(repo, {
      blockRunner: makeRunner(),
      skipGit: true,
      ...PIPELINE_OFF,
    });

    expect(second.merge.openConflicts).toEqual([]);

    // claims.json now contains the picked Order endpoint claim, and
    // every claim is sourced from PRDv2 (PRDv1 was superseded).
    const claims = readClaims(repo);
    expect(claims).not.toBeNull();
    const ordersClaim = claims!.claims.find((c) => c.subject === 'POST /api/v1/orders');
    expect(ordersClaim).toBeDefined();
    expect(ordersClaim?.module).toBe('orders');
    expect(ordersClaim?.provenance.file).toBe('docs/PRDs/backend_PRDv2.md');

    // health endpoint moved to its own module via the path-based
    // module detector.
    const healthClaim = claims!.claims.find((c) => c.subject === 'GET /health');
    expect(healthClaim?.module).toBe('health');

    // Module manifests survive: each module shows up exactly once
    // with the picked source on its sourceDocs.
    const modulesByName = new Map(claims!.modules.map((m) => [m.name, m]));
    expect(modulesByName.get('orders')?.sourceDocs).toEqual(['docs/PRDs/backend_PRDv2.md']);
    expect(modulesByName.get('health')?.sourceDocs).toEqual(['docs/PRDs/backend_PRDv2.md']);
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
      blockRunner: countingRunner,
      skipGit: true,
      ...PIPELINE_OFF,
    });
    const firstRunCalls = calls;
    expect(firstRunCalls).toBeGreaterThan(0);

    // Second run hits the cache for every block.
    calls = 0;
    await consolidate(repo, {
      blockRunner: countingRunner,
      skipGit: true,
      ...PIPELINE_OFF,
    });
    expect(calls).toBe(0);
  });

  it("editing a doc invalidates only that doc's blocks", async () => {
    buildMiniRepo();
    let calls = 0;
    const counting: BlockRunner = async (blocks) => {
      calls += blocks.length;
      return makeRunner()(blocks);
    };
    await consolidate(repo, {
      blockRunner: counting,
      skipGit: true,
      ...PIPELINE_OFF,
    });
    const baseline = calls;

    // Edit only PRDv2 — PRDv1 blocks should still be cached.
    const v2 = path.join(repo, 'docs/PRDs/backend_PRDv2.md');
    fs.writeFileSync(v2, fs.readFileSync(v2, 'utf-8') + '\n\n## Appendix\nNew note.\n');

    calls = 0;
    await consolidate(repo, {
      blockRunner: counting,
      skipGit: true,
      ...PIPELINE_OFF,
    });
    // Some calls (the changed blocks) but strictly fewer than baseline.
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBeLessThan(baseline);
  });
});

describe('readDecisions / writeDecisions', () => {
  it('returns empty default when decisions.json is missing', () => {
    expect(readDecisions(repo)).toEqual({ version: 1, decisions: [], manualChains: [], manualIncludes: [] });
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
      manualIncludes: [],
    };
    writeDecisions(repo, decisions);
    expect(readDecisions(repo)).toEqual(decisions);
  });

  it('returns empty default when decisions.json is corrupt (no crash on stale state)', () => {
    const decFile = path.join(repo, '.truecourse/specs/decisions.json');
    fs.mkdirSync(path.dirname(decFile), { recursive: true });
    fs.writeFileSync(decFile, '{ corrupt');
    expect(readDecisions(repo)).toEqual({ version: 1, decisions: [], manualChains: [], manualIncludes: [] });
  });
});
