/**
 * The SCAN RUN end to end (plan 02 steps 3–5): discover → curate-doc sessions →
 * settle-areas → group → overlap sessions → assemble + persist corpus.json.
 * `curate()` — the one-shot orchestration this file was written against — is
 * retired; the run now lives in `packages/core/src/services/spec-scan/run.ts`
 * and every LLM stage is a session, so the stubs are a scripted SessionDriver
 * instead of five per-stage runners.
 *
 * Retired with their stages: the separate `verifyFlaggedOverlaps` precision pass
 * (the overlap session adjudicates inline, so nothing is "refuted" after the
 * fact — `stats.overlapRefuted` is always 0), and the per-pair window MATRIX
 * (one session reads the area's docs by section instead of N×M windows).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resetKvCacheStore } from '@truecourse/llm';
import { runSpecScanSessions } from '../../packages/core/src/services/spec-scan/run';
import { readCorpus } from '../../packages/spec-consolidator/src/index.js';
import type { DecisionsFile, DocCandidate } from '../../packages/spec-consolidator/src/index.js';
import type { SessionDriver } from '../../packages/agent-loop/src/index';
import {
  docPathOf,
  memoryPersistence,
  outcome,
  stubDriver,
  toolResult,
  type StubCall,
  type StubScript,
} from '../core/spec-scan-session-stub';

function doc(p: string, content = `body of ${p}`): DocCandidate {
  return {
    path: p,
    absPath: '',
    content,
    kind: 'prd',
    preview: content.split('\n').slice(0, 5).join('\n'),
    lastTouched: '2026-01-01T00:00:00Z',
    contentHash: `hash-${p}`,
    size: content.length,
  };
}

// The kept docs carry pairwise-shared claim tokens so the deterministic
// collision pairing (item 119) nominates every within-area pair — without a
// shared identifier or heading, a doc pair costs no session and can flag
// nothing. The bodies keep the `body of <path>` line the flag() quotes pin.
const DOCS = [
  doc('docs/users-v1.md', 'body of docs/users-v1.md\n\nUses `userList`, `userQuota`, `authRealm`, `authScope`.\n'),
  doc('docs/users-v2.md', 'body of docs/users-v2.md\n\nUses `userList`, `userQuota`, `sessionKey`, `sessionTtl`.\n'),
  doc('docs/auth.md', 'body of docs/auth.md\n\nUses `authRealm`, `authScope`, `sessionKey`, `sessionTtl`.\n'),
  doc('notes/scratch.md'),
];

const EMPTY_DECISIONS: DecisionsFile = {
  version: 2,
  manualIncludes: [],
  manualExcludes: [],
  manualAreas: [],
  conflictResolutions: [],
  scopeVerdicts: [],
  instructions: [],
};

/** The area a `spec-scan.overlap` briefing is about. */
const areaOf = (briefing: string): string => /^Area: (.+)$/m.exec(briefing)?.[1] ?? '';

type OverlapFlag = {
  docs: [string, string];
  note: string;
  sections: Array<{ doc: string; heading: string | null; quote: string }>;
  review: unknown;
};

const REVIEW = {
  explanation: 'the two users docs disagree on the same field',
  recommendation: { action: 'pick-b' as const, rationale: 'users-v2 is the newer doc' },
};

/** An overlap flag pinned at both docs' leads (heading-free bodies). */
const flag = (a: string, b: string, review: unknown = REVIEW): OverlapFlag => ({
  docs: [a, b],
  note: `${a} vs ${b}`,
  sections: [
    { doc: a, heading: null, quote: `body of ${a}` },
    { doc: b, heading: null, quote: `body of ${b}` },
  ],
  review,
});

/** The doc pairs of a briefing's CANDIDATE COLLISIONS checklist, in order. */
const checklistPairs = (briefing: string): Array<[string, string]> =>
  [...briefing.matchAll(/^ {2}\d+\. (\S+) · .+? {2}<-> {2}(\S+) · /gm)].map((m) => [m[1], m[2]]);

/** Every briefed candidate pair, flagged — the shape of an obedient session. */
const allPairs = (briefing: string, review?: unknown): OverlapFlag[] =>
  checklistPairs(briefing).map(([a, b]) => flag(a, b, review));

/**
 * The scan's three session kinds, scripted. `curate` answers per doc;
 * `overlaps` answers per cluster session (default: flag every pair of the
 * briefed checklist); the settlement is always the empty one.
 */
function scanScript(opts: {
  curate: (call: StubCall) => unknown;
  overlaps?: (areaId: string, briefedDocs: string[], briefing: string) => OverlapFlag[];
}): StubScript {
  return async (call) => {
    if (call.kind === 'spec-scan.settle-areas') {
      await call.emit(toolResult('check_settlement', 'valid'));
      return outcome({ concernMerges: {}, productMerges: {}, productVerdicts: [], subdivisions: [] });
    }
    if (call.kind === 'spec-scan.overlap') {
      const areaId = areaOf(call.briefing);
      const briefed = [...call.briefing.matchAll(/^--- doc: (\S+)  ·/gm)].map((m) => m[1]);
      await call.emit(toolResult('check_findings', 'valid'));
      return outcome({ overlaps: opts.overlaps?.(areaId, briefed, call.briefing) ?? [], notReached: [] });
    }
    return outcome(opts.curate(call));
  };
}

/** Skip the scratch note; keep the rest, tagged by path. */
const CURATE_BY_PATH = (call: StubCall): unknown => {
  const p = docPathOf(call.briefing);
  if (p === 'notes/scratch.md') {
    return {
      keep: false,
      reason: 'scratch',
      subject: 'this-product',
      category: 'scratch',
      areas: [],
      status: null,
    };
  }
  const areas =
    p === 'docs/auth.md'
      ? [
          { product: 'core', concern: 'auth' },
          { product: 'core', concern: 'users' },
        ]
      : [{ product: 'core', concern: 'users' }];
  return { keep: true, reason: 'spec', subject: 'this-product', areas, status: 'shipped' };
};

let repo: string;
beforeEach(() => {
  resetKvCacheStore();
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-curate-'));
});
afterEach(() => {
  resetKvCacheStore();
  fs.rmSync(repo, { recursive: true, force: true });
});

interface RunExtra {
  decisions?: DecisionsFile | undefined;
  docSource?: () => DocCandidate[];
  skipCorpusWrite?: boolean;
  repoIdentity?: Parameters<typeof runSpecScanSessions>[0]['repoIdentity'];
  disableOverlapDetection?: boolean;
  driver?: SessionDriver;
  overlaps?: (areaId: string, briefedDocs: string[], briefing: string) => OverlapFlag[];
  curate?: (call: StubCall) => unknown;
}

function run(extra: RunExtra = {}) {
  const { overlaps, curate, driver, ...rest } = extra;
  const stub =
    driver ??
    stubDriver(
      scanScript({
        curate: curate ?? CURATE_BY_PATH,
        overlaps: overlaps ?? ((_area, _briefed, briefing) => allPairs(briefing)),
      }),
    ).driver;
  return runSpecScanSessions({
    repoRoot: repo,
    driver: async () => stub,
    persistence: memoryPersistence().persistence,
    docSource: () => DOCS,
    decisions: EMPTY_DECISIONS,
    skipGit: true,
    ...rest,
  });
}

describe('the scan run', () => {
  it('curates docs into an area-grouped corpus with overlaps', async () => {
    const result = await run();

    // The curation session dropped the scratch note.
    expect(result.skippedDocs).toEqual([
      { path: 'notes/scratch.md', reason: 'scratch', category: 'scratch' },
    ]);
    expect(result.corpus.docs.map((d) => d.ref).sort()).toEqual([
      'docs/auth.md',
      'docs/users-v1.md',
      'docs/users-v2.md',
    ]);

    // Areas: core/auth (auth.md only) + core/users-entity (all three).
    expect(result.corpus.areas.map((a) => a.id)).toEqual(['core/auth', 'core/users-entity']);
    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    expect(usersArea.docRefs).toEqual(['docs/auth.md', 'docs/users-v1.md', 'docs/users-v2.md']);

    // Every nominated pair the session flagged reached the corpus, under the
    // ONE area each pair was assigned to (all three pairs share users-entity).
    const overlapPairs = usersArea.overlaps.map((o) => [...o.docs].sort());
    expect(overlapPairs).toContainEqual(['docs/auth.md', 'docs/users-v1.md']);
    expect(overlapPairs).toContainEqual(['docs/auth.md', 'docs/users-v2.md']);
    expect(overlapPairs).toContainEqual(['docs/users-v1.md', 'docs/users-v2.md']);

    expect(result.stats.docsScanned).toBe(4);
    expect(result.stats.docsKept).toBe(3);
    expect(result.stats.areaCount).toBe(2);
    expect(result.stats.overlapFlags).toBe(3);
    // The session adjudicates inline: there is no separate refutation pass.
    expect(result.stats.overlapRefuted).toBe(0);
  });

  it('persists corpus.json (round-trips through readCorpus)', async () => {
    const result = await run();
    const read = readCorpus(repo);
    expect(read).not.toBeNull();
    expect(read!.version).toBe(3);
    expect(read!.areas.map((a) => a.id)).toEqual(['core/auth', 'core/users-entity']);
    // The returned in-memory corpus must equal the persisted file (same generatedAt).
    expect(read!.generatedAt).toBe(result.corpus.generatedAt);
    expect(read).toEqual(result.corpus);
  });

  it('skips the write when skipCorpusWrite is set', async () => {
    const result = await run({ skipCorpusWrite: true });
    expect(result.corpus.areas).toHaveLength(2);
    expect(readCorpus(repo)).toBeNull();
  });

  it('applies manualAreas', async () => {
    const decisions: DecisionsFile = {
      ...EMPTY_DECISIONS,
      manualAreas: [{ doc: 'docs/auth.md', areas: ['core/auth'] }],
    };
    const result = await run({ decisions });

    // auth.md re-homed to core/auth only → users-entity now has just the two users docs.
    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    expect(usersArea.docRefs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
    expect(usersArea.overlaps).toHaveLength(1);
    expect(usersArea.overlaps[0].docs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
  });

  it('force-excludes a doc via manualExcludes — dropped from the corpus + its overlaps', async () => {
    const decisions: DecisionsFile = { ...EMPTY_DECISIONS, manualExcludes: ['docs/auth.md'] };
    const result = await run({ decisions });

    expect(result.corpus.docs.map((d) => d.ref)).not.toContain('docs/auth.md');
    expect(result.corpus.areas.map((a) => a.id)).toEqual(['core/users-entity']);
    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    expect(usersArea.docRefs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
    expect(usersArea.overlaps).toHaveLength(1);
    expect(usersArea.overlaps[0].docs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
    expect(result.stats.docsKept).toBe(2);
  });

  it('reads manualAreas from a legacy v1 decisions.json on disk when not injected', async () => {
    const specsDir = path.join(repo, '.truecourse', 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(
      path.join(specsDir, 'decisions.json'),
      JSON.stringify({
        version: 1,
        manualIncludes: [],
        relations: [{ type: 'precedence', older: 'a.md', newer: 'b.md' }], // legacy, dropped on parse
        manualAreas: [{ doc: 'docs/auth.md', areas: ['core/auth'] }],
      }),
    );
    const result = await run({ decisions: undefined });
    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    expect(usersArea.docRefs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
  });
});

// ---------------------------------------------------------------------------
// The overlap session's adjudication rides into the corpus
// ---------------------------------------------------------------------------

describe('the scan run — overlap adjudication', () => {
  it('a flagged overlap carries its resolution brief into (and through) the corpus', async () => {
    const result = await run({
      overlaps: (_area, briefed) =>
        briefed.length === 3 ? [flag('docs/users-v1.md', 'docs/users-v2.md')] : [],
    });

    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    expect(usersArea.overlaps).toHaveLength(1);
    expect(usersArea.overlaps[0].review).toEqual(REVIEW);

    // The brief survives the persist → read round-trip through corpus.json.
    const persisted = readCorpus(repo)!;
    expect(persisted.areas.find((a) => a.id === 'core/users-entity')!.overlaps[0].review).toEqual(
      REVIEW,
    );
  });

  it('drops a flag naming a doc the session was never briefed on, keeping the valid one', async () => {
    const result = await run({
      overlaps: (_area, briefed) =>
        briefed.length === 3
          ? [
              flag('docs/users-v1.md', 'docs/users-v2.md'),
              flag('docs/users-v1.md', 'docs/not-in-the-universe.md'),
            ]
          : [],
    });
    expect(result.stats.overlapFlags).toBe(1);
    expect(result.stats.openOverlaps).toEqual([
      { area: 'core/users-entity', a: 'docs/users-v1.md', b: 'docs/users-v2.md' },
    ]);
  });

  // The window MATRIX is gone: however large the docs, a collision cluster
  // costs ONE session (the shared `## Defaults` heading pairs them).
  it('costs one overlap session per cluster, whatever the docs weigh', async () => {
    const big = (name: string): string =>
      [
        `# ${name}`,
        '## Defaults',
        ...Array.from({ length: 4000 }, (_, i) => `${name} setting ${i} defaults to auto.`),
      ].join('\n');
    const DOCS_BIG = [doc('docs/gateway.md', big('gateway')), doc('docs/ingress.md', big('ingress'))];
    const stub = stubDriver(
      scanScript({
        curate: () => ({
          keep: true,
          reason: 'spec',
          subject: 'this-product',
          areas: [{ product: 'core', concern: 'config' }],
          status: 'shipped',
        }),
      }),
    );

    await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => stub.driver,
      persistence: memoryPersistence().persistence,
      docSource: () => DOCS_BIG,
      decisions: EMPTY_DECISIONS,
      skipGit: true,
    });

    expect(stub.calls.filter((c) => c.kind === 'spec-scan.overlap')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Include-scope — the real filesystem discovery path (NOT docSource, which
// bypasses scoping), so config `spec.include` actually applies.
// ---------------------------------------------------------------------------

describe('the scan run — include-scope', () => {
  function place(rel: string, body: string): void {
    const full = path.join(repo, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  function config(include: string[]): void {
    place('.truecourse/config.json', JSON.stringify({ spec: { include } }));
  }
  function runFs(decisions: DecisionsFile = EMPTY_DECISIONS) {
    const stub = stubDriver(
      scanScript({
        curate: () => ({
          keep: true,
          reason: 'spec',
          subject: 'this-product',
          areas: [{ product: 'core', concern: 'x' }],
          status: 'shipped',
        }),
      }),
    );
    return runSpecScanSessions({
      repoRoot: repo,
      driver: async () => stub.driver,
      persistence: memoryPersistence().persistence,
      decisions,
      disableOverlapDetection: true,
      // The scope orchestrator is step 6's own subject; these cases are about the
      // config-level include scope, so they run with it switched off.
      disableScopeOrchestration: true,
      skipGit: true,
    });
  }

  it('scans only in-scope docs and reports the active scope', async () => {
    config(['docs/**']);
    place('docs/spec.md', '# in scope');
    place('reference/answers.md', '# out of scope');

    const result = await runFs();
    expect(result.stats.scopeGlobs).toEqual(['docs/**']);
    expect(result.stats.docsScanned).toBe(1);
    expect(result.corpus.docs.map((d) => d.ref)).toEqual(['docs/spec.md']);
  });

  it('an out-of-scope doc never appears in skippedDocs', async () => {
    config(['docs/**']);
    place('docs/spec.md', '# in scope');
    place('reference/answers.md', '# out of scope');

    const result = await runFs();
    // Out-of-scope docs never enter the universe, so they are neither kept nor
    // "skipped" — they must not surface in the dashboard's not-included list.
    expect(result.skippedDocs.map((s) => s.path)).not.toContain('reference/answers.md');
    expect(result.corpus.skippedDocs.map((s) => s.ref)).not.toContain('reference/answers.md');
  });

  it('surfaces an out-of-scope manualInclude instead of silently dropping it', async () => {
    config(['docs/**']);
    place('docs/spec.md', '# in scope');
    place('reference/answers.md', '# out of scope, but force-included');

    const result = await runFs({ ...EMPTY_DECISIONS, manualIncludes: ['reference/answers.md'] });
    // A manual include is a relevance-level override, not a universe override:
    // the out-of-scope path stays out, but is surfaced so it isn't a silent no-op.
    expect(result.stats.outOfScopeManualIncludes).toEqual(['reference/answers.md']);
    expect(result.corpus.docs.map((d) => d.ref)).toEqual(['docs/spec.md']);
  });

  it('no scope configured → empty scopeGlobs, everything scanned', async () => {
    place('docs/spec.md', '# a');
    place('reference/x.md', '# b');

    const result = await runFs();
    expect(result.stats.scopeGlobs).toEqual([]);
    expect(result.stats.outOfScopeManualIncludes).toEqual([]);
    expect(result.stats.docsScanned).toBe(2);
  });
});

/**
 * F12 visibility: the third-party drop rate is what made the bug invisible for
 * so long — cal.com's whole v2 API reference vanished into an undifferentiated
 * "7 dropped". Both counters are reported, not just the first: `restored` is the
 * regression detector.
 */
describe('the scan run — third-party visibility', () => {
  const identity = { name: 'wekan', aliases: ['Wekan'], sources: ['git-remote'] };

  const DOCS_WITH_VENDOR = [
    doc('docs/auth.md', 'How auth works here.'),
    doc('docs/trello.md', 'Trello is a third-party kanban platform.'),
    doc('docs/api.md', 'The Wekan API exposes custom fields.'),
  ];

  // Reproduces the measured failure: the model calls our OWN api doc third-party
  // because it names our product, exactly like a vendor's docs would.
  const vendorConfused = (call: StubCall): unknown => {
    const p = docPathOf(call.briefing);
    return p === 'docs/auth.md'
      ? {
          keep: true,
          reason: 'spec',
          subject: 'this-product',
          areas: [{ product: 'core', concern: 'auth' }],
          status: null,
        }
      : {
          keep: false,
          reason: `vendor API research (${p})`,
          subject: 'different-product',
          category: 'third-party',
          areas: [{ product: 'core', concern: 'auth' }],
          status: null,
        };
  };

  const runVendor = () =>
    runSpecScanSessions({
      repoRoot: repo,
      driver: async () =>
        stubDriver(scanScript({ curate: vendorConfused })).driver,
      persistence: memoryPersistence().persistence,
      docSource: () => DOCS_WITH_VENDOR,
      decisions: EMPTY_DECISIONS,
      repoIdentity: identity,
      disableOverlapDetection: true,
      skipCorpusWrite: true,
      skipGit: true,
    });

  it('counts third-party drops and backstop restores separately', async () => {
    const res = await runVendor();
    expect(res.stats.thirdPartyDropped).toBe(2); // both were dropped as third-party
    expect(res.stats.thirdPartyRestored).toBe(1); // only ours names our product
    expect(res.stats.docsKept).toBe(2);
    expect(res.skippedDocs.map((s) => s.path)).toEqual(['docs/trello.md']);
  });

  it('records the skip category on the corpus so the dashboard can group drops', async () => {
    const res = await runVendor();
    expect(res.corpus.skippedDocs).toEqual([
      { ref: 'docs/trello.md', reason: expect.stringMatching(/vendor/), category: 'third-party' },
    ]);
  });

  // EE scans an ephemeral shallow clone in a temp dir. If an explicit null were
  // treated as "resolve it yourself", the basename `tc-gate-scan-XXXX` would
  // become the repo's identity — and it would reach the session in the briefing.
  it('honors an explicitly null identity instead of resolving one', async () => {
    const briefings: string[] = [];
    const stub = stubDriver(
      scanScript({
        curate: (call) => {
          briefings.push(call.briefing);
          return {
            keep: true,
            reason: 'spec',
            subject: 'this-product',
            areas: [{ product: 'core', concern: 'auth' }],
            status: null,
          };
        },
      }),
    );
    await runSpecScanSessions({
      repoRoot: repo,
      driver: async () => stub.driver,
      persistence: memoryPersistence().persistence,
      docSource: () => [doc('docs/auth.md')],
      decisions: EMPTY_DECISIONS,
      repoIdentity: null,
      disableOverlapDetection: true,
      skipCorpusWrite: true,
      skipGit: true,
    });
    expect(briefings).toHaveLength(1);
    expect(briefings[0]).not.toMatch(/IDENTITY/);
    expect(briefings[0]).not.toContain(path.basename(repo));
  });
});

/**
 * A stored conflict verdict that matches no overlap the fresh corpus flags is
 * PRUNED in the same write cycle the corpus rides — decisions.json never
 * accumulates bookkeeping about disputes that stopped existing.
 */
describe('the scan run — orphaned conflict-verdict prune', () => {
  const specsDir = () => path.join(repo, '.truecourse', 'specs');
  const decisionsFile = () => path.join(specsDir(), 'decisions.json');

  /** A section-scoped verdict on a doc pair, anchored at both preambles. */
  const verdict = (docA: string, docB: string) => ({
    docA,
    anchorA: null,
    docB,
    anchorB: null,
    verdict: 'a' as const,
    resolvedAt: '2026-07-20T00:00:00Z',
  });

  const seedDecisions = (conflictResolutions: unknown[], extra: Record<string, unknown> = {}): void => {
    fs.mkdirSync(specsDir(), { recursive: true });
    fs.writeFileSync(
      decisionsFile(),
      JSON.stringify({
        version: 1,
        manualIncludes: [],
        manualExcludes: [],
        manualAreas: [],
        conflictResolutions,
        ...extra,
      }),
    );
  };

  const readStored = () => JSON.parse(fs.readFileSync(decisionsFile(), 'utf-8'));

  /** The run reading decisions.json from disk (never the injected seam). */
  const runFromDisk = (extra: RunExtra = {}) => run({ decisions: undefined, ...extra });

  it('keeps a verdict that still matches a flagged conflict', async () => {
    seedDecisions([verdict('docs/users-v1.md', 'docs/users-v2.md')]);

    const result = await runFromDisk();

    expect(readStored().conflictResolutions).toHaveLength(1);
    expect(result.decisions.conflictResolutions).toHaveLength(1);
  });

  it('removes a verdict that matches no flagged conflict, keeping the rest of the file', async () => {
    seedDecisions([verdict('docs/gone.md', 'docs/moved.md')], {
      manualIncludes: ['docs/auth.md'],
      manualAreas: [{ doc: 'docs/auth.md', areas: ['core/auth'] }],
    });

    const result = await runFromDisk();

    const stored = readStored();
    expect(stored.conflictResolutions).toEqual([]);
    // Only the stranded verdict goes — every other decision is untouched.
    expect(stored.manualIncludes).toEqual(['docs/auth.md']);
    expect(stored.manualAreas).toEqual([{ doc: 'docs/auth.md', areas: ['core/auth'] }]);
    expect(result.decisions.conflictResolutions).toEqual([]);
  });

  it('prunes ONLY the orphan when a live verdict sits beside it', async () => {
    seedDecisions([verdict('docs/gone.md', 'docs/moved.md'), verdict('docs/users-v1.md', 'docs/users-v2.md')]);

    await runFromDisk();

    expect(readStored().conflictResolutions).toEqual([
      expect.objectContaining({ docA: 'docs/users-v1.md', docB: 'docs/users-v2.md' }),
    ]);
  });

  it('leaves decisions.json byte-identical when nothing is orphaned', async () => {
    seedDecisions([verdict('docs/users-v1.md', 'docs/users-v2.md')], { relations: [{ legacy: true }] });
    const before = fs.readFileSync(decisionsFile(), 'utf-8');

    await runFromDisk();

    // No write at all — not even a reformat that would drop the legacy key.
    expect(fs.readFileSync(decisionsFile(), 'utf-8')).toBe(before);
  });

  it('leaves decisions.json alone when no corpus is written', async () => {
    seedDecisions([verdict('docs/gone.md', 'docs/moved.md')]);
    const before = fs.readFileSync(decisionsFile(), 'utf-8');

    await runFromDisk({ skipCorpusWrite: true });

    // The prune rides the corpus write; a dry read must never mutate the store.
    expect(fs.readFileSync(decisionsFile(), 'utf-8')).toBe(before);
  });
});

/**
 * HIGH-confidence recommendation auto-apply: a confirmed conflict whose brief
 * grades its actionable recommendation `high` is resolved BY THE SCAN as a
 * `resolvedBy: 'auto'` conflict resolution — visible, undoable, suppressing like
 * a user verdict. Lower grades and `fix-doc` stay advisory, an existing verdict
 * always wins, and nothing is written on a dry (skipCorpusWrite) run.
 */
describe('the scan run — high-confidence recommendation auto-apply', () => {
  const specsDir = () => path.join(repo, '.truecourse', 'specs');
  const decisionsFile = () => path.join(specsDir(), 'decisions.json');
  const readStored = () => JSON.parse(fs.readFileSync(decisionsFile(), 'utf-8'));

  /** Flags ONLY the users-v1 ↔ users-v2 pair, carrying the given brief. */
  const withBrief = (recommendation: {
    action: 'pick-a' | 'pick-b' | 'fix-doc' | 'dismiss';
    rationale: string;
    fix?: string;
    confidence?: 'low' | 'medium' | 'high';
  }) =>
    (_area: string, briefed: string[]): OverlapFlag[] =>
      briefed.includes('docs/users-v1.md') && briefed.includes('docs/users-v2.md')
        ? [
            flag('docs/users-v1.md', 'docs/users-v2.md', {
              explanation: 'the two users docs disagree on the same field',
              recommendation,
            }),
          ]
        : [];

  it('applies a high-confidence pick verdict as a resolvedBy:auto resolution', async () => {
    const result = await run({
      decisions: undefined,
      overlaps: withBrief({ action: 'pick-b', rationale: 'users-v2 is the newer doc', confidence: 'high' }),
    });

    const stored = readStored().conflictResolutions;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      verdict: 'b',
      resolvedBy: 'auto',
      note: 'users-v2 is the newer doc',
    });
    expect([stored[0].docA, stored[0].docB].sort()).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
    expect(result.stats.autoResolvedConflicts).toHaveLength(1);
    expect(result.stats.autoResolvedConflicts[0].verdict).toBe('b');
    expect(result.decisions.conflictResolutions).toHaveLength(1);
  });

  it('a high-confidence dismissal auto-applies as a dismissed verdict', async () => {
    const result = await run({
      decisions: undefined,
      overlaps: withBrief({ action: 'dismiss', rationale: 'the two coexist', confidence: 'high' }),
    });
    expect(readStored().conflictResolutions[0]).toMatchObject({ verdict: 'dismissed', resolvedBy: 'auto' });
    expect(result.stats.autoResolvedConflicts).toEqual([
      expect.objectContaining({ verdict: 'dismissed' }),
    ]);
  });

  it('medium confidence stays advisory — nothing is written', async () => {
    const result = await run({
      decisions: undefined,
      overlaps: withBrief({ action: 'pick-b', rationale: 'probably v2', confidence: 'medium' }),
    });
    expect(fs.existsSync(decisionsFile())).toBe(false);
    expect(result.stats.autoResolvedConflicts).toEqual([]);
  });

  it('a high-confidence fix-doc never auto-applies (a doc edit is not a verdict)', async () => {
    const result = await run({
      decisions: undefined,
      overlaps: withBrief({
        action: 'fix-doc',
        rationale: 'users-v1 needs a correction',
        fix: 'update the field default in users-v1',
        confidence: 'high',
      }),
    });
    expect(fs.existsSync(decisionsFile())).toBe(false);
    expect(result.stats.autoResolvedConflicts).toEqual([]);
  });

  it('an existing resolution always wins — auto-apply never touches a resolved dispute', async () => {
    fs.mkdirSync(specsDir(), { recursive: true });
    fs.writeFileSync(
      decisionsFile(),
      JSON.stringify({
        version: 1,
        manualIncludes: [],
        manualExcludes: [],
        manualAreas: [],
        conflictResolutions: [
          {
            docA: 'docs/users-v1.md',
            anchorA: null,
            docB: 'docs/users-v2.md',
            anchorB: null,
            verdict: 'a',
            resolvedAt: '2026-07-20T00:00:00Z',
          },
        ],
      }),
    );

    const result = await run({
      decisions: undefined,
      overlaps: withBrief({ action: 'pick-b', rationale: 'v2 is newer', confidence: 'high' }),
    });

    // The user's 'a' verdict stands; no auto entry joins it.
    const stored = readStored().conflictResolutions;
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ verdict: 'a' });
    expect(stored[0].resolvedBy).toBeUndefined();
    expect(result.stats.autoResolvedConflicts).toEqual([]);
  });

  it('writes nothing on a dry (skipCorpusWrite) run', async () => {
    const result = await run({
      decisions: undefined,
      skipCorpusWrite: true,
      overlaps: withBrief({ action: 'pick-b', rationale: 'v2 is newer', confidence: 'high' }),
    });
    expect(fs.existsSync(decisionsFile())).toBe(false);
    expect(result.stats.autoResolvedConflicts).toEqual([]);
  });
});
