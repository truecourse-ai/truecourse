/**
 * The SCAN RUN end to end: discover → curate-doc sessions →
 * settle-areas → group → conflict sessions → assemble + persist corpus.json.
 * `curate()` — the one-shot orchestration this file was written against — is
 * retired; the run now lives in `packages/core/src/services/spec-scan/run.ts`
 * and every LLM stage is a session, so the stubs are a scripted SessionDriver
 * instead of five per-stage runners.
 *
 * Retired with their stages: the separate precision pass (the conflicts
 * session adjudicates inline, so nothing is "refuted" after the fact), and the
 * per-pair window MATRIX (one session reads the area's docs by section instead
 * of N×M windows).
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
import { compare, record, settle, type StubReview, type SentenceClaim } from '../core/spec-scan-claims-stub';
import { sentenceKey } from '../../packages/shared/src/spec/conflict-resolution.js';

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

// Each kept doc opens with its `body of <path>` line: the one unit the
// scripted extractor states a claim from, so every doc holds one claim about the
// same subject and the comparer can put any two in conflict.
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

const REVIEW: StubReview = {
  explanation: 'the two users docs disagree on the same field',
  recommendation: { action: 'pick-b', rationale: 'users-v2 is the newer doc' },
};

/** The extractor states one claim per doc, from its opening line, all about one subject. */
const bodyClaim: SentenceClaim = ({ line }, doc) => (line === `body of ${doc}` ? { subject: 'the body', statement: line } : null);

/** Which two docs the comparer puts in conflict. */
type Pairs = (a: string, b: string) => boolean;
const everyPair: Pairs = () => true;
const usersPair: Pairs = (a, b) => [a, b].sort().join() === 'docs/users-v1.md,docs/users-v2.md';

/**
 * The scan's session kinds, scripted. `curate` answers per doc; the extractor
 * states each doc's body as a claim; the comparer puts every pair `conflicts`
 * names in conflict, carrying `review`; the settlements are always empty.
 */
function scanScript(opts: { curate: (call: StubCall) => unknown; conflicts?: Pairs; review?: StubReview }): StubScript {
  const wanted = opts.conflicts ?? everyPair;
  return async (call) => {
    if (call.kind === 'spec-scan.settle-areas') {
      await call.emit(toolResult('check_settlement', 'valid'));
      return outcome({ concernMerges: [], productMerges: [], productVerdicts: [], subdivisions: [] });
    }
    if (call.kind === 'spec-scan.record-facts') return record(call, bodyClaim);
    if (call.kind === 'spec-scan.settle-subjects') return settle(call);
    if (call.kind === 'spec-scan.compare-facts') {
      return compare(call, (a, b) => Number(a.id.slice(1)) < Number(b.id.slice(1)) && wanted(a.doc, b.doc), opts.review);
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
  disableConflictDetection?: boolean;
  driver?: SessionDriver;
  conflicts?: Pairs;
  review?: StubReview;
  curate?: (call: StubCall) => unknown;
}

function run(extra: RunExtra = {}) {
  const { conflicts, review, curate, driver, ...rest } = extra;
  const stub =
    driver ??
    stubDriver(
      scanScript({
        curate: curate ?? CURATE_BY_PATH,
        ...(conflicts ? { conflicts } : {}),
        ...(review ? { review } : {}),
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
  it('curates docs into an area-grouped corpus with conflicts', async () => {
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

    // Every pair the comparer put in conflict reached the corpus, under the
    // ONE area each pair was filed in (all three pairs share users-entity).
    const conflictPairs = usersArea.conflicts.map((o) => [...o.docs].sort());
    expect(conflictPairs).toContainEqual(['docs/auth.md', 'docs/users-v1.md']);
    expect(conflictPairs).toContainEqual(['docs/auth.md', 'docs/users-v2.md']);
    expect(conflictPairs).toContainEqual(['docs/users-v1.md', 'docs/users-v2.md']);

    expect(result.stats.docsScanned).toBe(4);
    expect(result.stats.docsKept).toBe(3);
    expect(result.stats.areaCount).toBe(2);
    expect(result.stats.conflictCount).toBe(3);
  });

  it('persists corpus.json (round-trips through readCorpus)', async () => {
    const result = await run();
    const read = readCorpus(repo);
    expect(read).not.toBeNull();
    expect(read!.version).toBe(5);
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
    expect(usersArea.conflicts).toHaveLength(1);
    expect(usersArea.conflicts[0].docs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
  });

  it('force-excludes a doc via manualExcludes — dropped from the corpus + its conflicts', async () => {
    const decisions: DecisionsFile = { ...EMPTY_DECISIONS, manualExcludes: ['docs/auth.md'] };
    const result = await run({ decisions });

    expect(result.corpus.docs.map((d) => d.ref)).not.toContain('docs/auth.md');
    expect(result.corpus.areas.map((a) => a.id)).toEqual(['core/users-entity']);
    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    expect(usersArea.docRefs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
    expect(usersArea.conflicts).toHaveLength(1);
    expect(usersArea.conflicts[0].docs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
    expect(result.stats.docsKept).toBe(2);
  });

  it('reads manualAreas from decisions.json on disk when not injected', async () => {
    const specsDir = path.join(repo, '.truecourse', 'specs');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(
      path.join(specsDir, 'decisions.json'),
      JSON.stringify({
        version: 3,
        manualIncludes: [],
        manualAreas: [{ doc: 'docs/auth.md', areas: ['core/auth'] }],
      }),
    );
    const result = await run({ decisions: undefined });
    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    expect(usersArea.docRefs).toEqual(['docs/users-v1.md', 'docs/users-v2.md']);
  });
});

// ---------------------------------------------------------------------------
// The comparison's adjudication rides into the corpus
// ---------------------------------------------------------------------------

describe('the scan run — conflict adjudication', () => {
  it('a conflict carries its resolution brief into (and through) the corpus', async () => {
    const result = await run({ conflicts: usersPair, review: REVIEW });

    const usersArea = result.corpus.areas.find((a) => a.id === 'core/users-entity')!;
    expect(usersArea.conflicts).toHaveLength(1);
    expect(usersArea.conflicts[0].review).toEqual(REVIEW);

    // The brief survives the persist → read round-trip through corpus.json.
    const persisted = readCorpus(repo)!;
    expect(persisted.areas.find((a) => a.id === 'core/users-entity')!.conflicts[0].review).toEqual(
      REVIEW,
    );
  });


});

// ---------------------------------------------------------------------------
// The real filesystem discovery path (NOT docSource, which supplies its own
// doc set): the run walks the whole tree — scope is the orchestrator's verdicts,
// never a glob the run is configured with.
// ---------------------------------------------------------------------------

describe('the scan run — discovery over the tree', () => {
  function place(rel: string, body: string): void {
    const full = path.join(repo, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
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
      disableConflictDetection: true,
      // The scope orchestrator is step 6's own subject; these cases are about
      // what the walk itself yields, so they run with it switched off.
      disableScopeOrchestration: true,
      skipGit: true,
    });
  }

  it('walks the whole tree — nothing narrows it', async () => {
    place('docs/spec.md', '# a');
    place('reference/x.md', '# b');

    const result = await runFs();
    expect(result.stats.docsScanned).toBe(2);
    expect(result.corpus.docs.map((d) => d.ref).sort()).toEqual(['docs/spec.md', 'reference/x.md']);
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
      disableConflictDetection: true,
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

  // A scan runs over an ephemeral scratch tree. If an explicit null were treated
  // as "resolve it yourself", the temp basename would become the repo's identity
  // — and it would reach the session in the briefing.
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
      disableConflictDetection: true,
      skipCorpusWrite: true,
      skipGit: true,
    });
    expect(briefings).toHaveLength(1);
    expect(briefings[0]).not.toMatch(/IDENTITY/);
    expect(briefings[0]).not.toContain(path.basename(repo));
  });
});

/**
 * A stored conflict verdict that matches no conflict the fresh corpus flags is
 * PRUNED in the same write cycle the corpus rides — decisions.json never
 * accumulates bookkeeping about conflicts that stopped existing.
 */
describe('the scan run — orphaned conflict-verdict prune', () => {
  const specsDir = () => path.join(repo, '.truecourse', 'specs');
  const decisionsFile = () => path.join(specsDir(), 'decisions.json');

  /** A verdict on the two docs' body sentences. */
  const verdict = (docA: string, docB: string) => ({
    docA,
    sentenceA: sentenceKey(`body of ${docA}`),
    docB,
    sentenceB: sentenceKey(`body of ${docB}`),
    verdict: 'a' as const,
    resolvedAt: '2026-07-20T00:00:00Z',
  });

  const seedDecisions = (conflictResolutions: unknown[], extra: Record<string, unknown> = {}): void => {
    fs.mkdirSync(specsDir(), { recursive: true });
    fs.writeFileSync(
      decisionsFile(),
      JSON.stringify({
        version: 3,
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

  /** ONLY the users-v1 ↔ users-v2 pair in conflict, carrying the given brief. */
  const withBrief = (recommendation: StubReview['recommendation']): Pick<RunExtra, 'conflicts' | 'review'> => ({
    conflicts: usersPair,
    review: { explanation: 'the two users docs disagree on the same field', recommendation },
  });

  it('applies a high-confidence pick verdict as a resolvedBy:auto resolution', async () => {
    const result = await run({
      decisions: undefined,
      ...withBrief({ action: 'pick-b', rationale: 'users-v2 is the newer doc', confidence: 'high' }),
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
      ...withBrief({ action: 'dismiss', rationale: 'the two coexist', confidence: 'high' }),
    });
    expect(readStored().conflictResolutions[0]).toMatchObject({ verdict: 'dismissed', resolvedBy: 'auto' });
    expect(result.stats.autoResolvedConflicts).toEqual([
      expect.objectContaining({ verdict: 'dismissed' }),
    ]);
  });

  it('medium confidence stays advisory — nothing is written', async () => {
    const result = await run({
      decisions: undefined,
      ...withBrief({ action: 'pick-b', rationale: 'probably v2', confidence: 'medium' }),
    });
    expect(fs.existsSync(decisionsFile())).toBe(false);
    expect(result.stats.autoResolvedConflicts).toEqual([]);
  });

  it('a high-confidence fix-doc never auto-applies (a doc edit is not a verdict)', async () => {
    const result = await run({
      decisions: undefined,
      ...withBrief({
        action: 'fix-doc',
        rationale: 'users-v1 needs a correction',
        fix: 'update the field default in users-v1',
        confidence: 'high',
      }),
    });
    expect(fs.existsSync(decisionsFile())).toBe(false);
    expect(result.stats.autoResolvedConflicts).toEqual([]);
  });

  it('an existing resolution always wins — auto-apply never touches a resolved conflict', async () => {
    fs.mkdirSync(specsDir(), { recursive: true });
    fs.writeFileSync(
      decisionsFile(),
      JSON.stringify({
        version: 3,
        manualIncludes: [],
        manualExcludes: [],
        manualAreas: [],
        conflictResolutions: [
          {
            docA: 'docs/users-v1.md',
            sentenceA: sentenceKey('body of docs/users-v1.md'),
            docB: 'docs/users-v2.md',
            sentenceB: sentenceKey('body of docs/users-v2.md'),
            verdict: 'a',
            resolvedAt: '2026-07-20T00:00:00Z',
          },
        ],
      }),
    );

    const result = await run({
      decisions: undefined,
      ...withBrief({ action: 'pick-b', rationale: 'v2 is newer', confidence: 'high' }),
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
      ...withBrief({ action: 'pick-b', rationale: 'v2 is newer', confidence: 'high' }),
    });
    expect(fs.existsSync(decisionsFile())).toBe(false);
    expect(result.stats.autoResolvedConflicts).toEqual([]);
  });
});
