import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import request from 'supertest';
import { type Express } from 'express';

/** `spec corpus/scan` requires a git repo (like analyze) — init the fixture so the route guard passes. */
function gitInit(dir: string): void {
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t.co', { cwd: dir });
  execSync('git config user.name test', { cwd: dir });
  execSync('git commit -q --allow-empty -m init', { cwd: dir });
}

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  return {
    ...actual,
    emitAnalysisProgress: vi.fn(),
    emitAnalysisComplete: vi.fn(),
    emitViolationsReady: vi.fn(),
    emitFilesChanged: vi.fn(),
    emitAnalysisCanceled: vi.fn(),
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
    createSocketTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
    createSocketLlmEstimateHandler: () => () => Promise.resolve(true),
    createSocketSpecEstimateHandler: () => () => Promise.resolve(true),
    createSocketStashConfirmHandler: () => () => Promise.resolve('stash'),
  };
});

// The curate engine has its own suite (tests/spec-consolidator), so stub it to a
// no-op here — leaving the seeded corpus.json intact. A decision route must NEVER
// invoke it: a decision is not a corpus change.
vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>();
  return {
    ...actual,
    curateInProcess: vi.fn(async () => ({ noChanges: false })),
  };
});

import { createTestApp } from '../helpers/test-app';
import { curateInProcess } from '@truecourse/core/commands/spec-in-process';
import {
  setBackgroundTaskRunner,
  type BackgroundTask,
} from '@truecourse/core/lib/background-tasks';
import {
  setGuardStore,
  resetGuardStore,
  type GuardStore,
} from '@truecourse/core/lib/guard-store';
import {
  setSpecStore,
  resetSpecStore,
  type SpecStore,
  type RepoRef,
  type SpecArtifact,
} from '@truecourse/core/lib/spec-store';
import { setGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import { writeLatest } from '@truecourse/core/lib/analysis-store';
import {
  readSourcesFile,
  sourceDirPath,
  sourcesDirPath,
  sourcesFilePath,
} from '../../packages/spec-consolidator/src/index.js';
import {
  INSTALLATION_MD,
  llmsTxtUrl,
  seedSource,
  startDocsSite,
  type FixtureSite,
} from '../spec-consolidator/sources-fixture.js';
import { emitSpecComplete } from '../../apps/dashboard/server/src/socket/handlers';
import type { GuardGenerateReport } from '@truecourse/shared';
import {
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-db';

/**
 * Spec route tests assert the HTTP shape of the corpus routes. The
 * curate/generate engine has its own suite under tests/spec-consolidator/ and
 * tests/contract-extractor/.
 */

/**
 * A minimal in-memory hosted `SpecStore` — the shape EE actually installs
 * (`materializesInPlace: false`, Postgres-backed). Map-backed round-trip for
 * decisions writes / corpus reads so the EE route paths (which read/write through
 * the ACTIVE spec store) work without a real database. Workspace scope is
 * unused here (throw / null, mirroring the file default).
 */
function makeMemSpecStore(): SpecStore {
  const byRef = new Map<string, unknown>(); // (repoKey, commitSha, artifact) → json
  const latest = new Map<string, unknown>(); // (repoKey, artifact) → json
  const rk = (ref: RepoRef, a: SpecArtifact) => `${ref.repoKey}\x00${ref.commitSha}\x00${a}`;
  const lk = (repoKey: string, a: SpecArtifact) => `${repoKey}\x00${a}`;
  return {
    materializesInPlace: false,
    async saveSpec(ref, artifact, json) {
      byRef.set(rk(ref, artifact), json);
      latest.set(lk(ref.repoKey, artifact), json);
    },
    async loadSpec<T = unknown>(ref: RepoRef, artifact: SpecArtifact) {
      return (byRef.get(rk(ref, artifact)) as T) ?? null;
    },
    async deleteSpec(ref, artifact) {
      byRef.delete(rk(ref, artifact));
    },
    async loadLatest<T = unknown>(repoKey: string, artifact: SpecArtifact) {
      return (latest.get(lk(repoKey, artifact)) as T) ?? null;
    },
    async latestCommit() {
      return null;
    },
    async saveWorkspaceSpec() {
      throw new Error('[mem-spec-store] workspace scope unused in these tests');
    },
    async loadWorkspaceSpec<T = unknown>() {
      return null as T | null;
    },
  } satisfies SpecStore;
}

describe('GET /api/repos/:id/spec/decisions', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    app = createTestApp();
  });

  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  it('returns the empty default when decisions.json is absent', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/spec/corpus`)
      .expect(404);
    expect(res.body.error).toMatch(/no corpus/i);
  });
});

describe('corpus routes (spec-scan redesign)', () => {
  let app: Express;
  let fixture: TestFixture;

  const seedCorpus = (overlaps: Array<{ docs: [string, string]; note: string }>): void => {
    const specs = path.join(fixture.repoPath, '.truecourse', 'specs');
    fs.mkdirSync(specs, { recursive: true });
    fs.writeFileSync(
      path.join(specs, 'corpus.json'),
      JSON.stringify({
        version: 3,
        generatedAt: '2026-01-01T00:00:00Z',
        docs: [
          { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'] },
          { ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'] },
        ],
        areas: [
          { id: 'booking/appointments', product: 'booking', concern: 'appointments', docRefs: ['docs/v1.md', 'docs/v2.md'], overlaps },
        ],
        relations: [],
        skippedDocs: [{ ref: 'docs/archived.md', reason: 'archived directory' }],
      }),
    );
    const docs = path.join(fixture.repoPath, 'docs');
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, 'v1.md'), '# Booking v1\nCancel up to 24h before.');
    fs.writeFileSync(path.join(docs, 'v2.md'), '# Booking v2\nCancel up to 48h before.');
  };

  beforeEach(async () => {
    fixture = await setupTestFixture();
    gitInit(fixture.repoPath); // include/exclude re-curate → route guards require git
    vi.mocked(curateInProcess).mockClear();
    app = createTestApp();
  });
  afterEach(async () => {
    setBackgroundTaskRunner(null);
    await teardownTestFixture(fixture.project.slug);
  });

  it('GET /spec/corpus → 404 before any scan', async () => {
    await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(404);
  });

  it('GET /spec/corpus → the corpus', async () => {
    seedCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h' }]);
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(200);
    expect(res.body.corpus.areas).toHaveLength(1);
    expect(res.body.corpus.areas[0].overlaps).toHaveLength(1);
  });

  it('GET /spec/doc → the markdown content; rejects traversal', async () => {
    seedCorpus([]);
    const ok = await request(app).get(`/api/repos/${fixture.project.slug}/spec/doc`).query({ ref: 'docs/v2.md' }).expect(200);
    expect(ok.body.content).toContain('48h');
    await request(app).get(`/api/repos/${fixture.project.slug}/spec/doc`).query({ ref: '../../etc/passwd' }).expect(400);
  });

  it('has no /spec/relations routes — unknown spec mutations 404', async () => {
    seedCorpus([]);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/relations`)
      .send({ type: 'precedence', older: 'docs/v1.md', newer: 'docs/v2.md' })
      .expect(404);
    await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/relations`)
      .send({ older: 'docs/v1.md', newer: 'docs/v2.md' })
      .expect(404);
  });

  // OSS batches decisions: an include/exclude persists to decisions.json and returns
  // the decision lists (no corpus) WITHOUT re-curating. One later Scan materializes
  // the batch. (The old per-click re-curate re-ran the set-level LLM stages each time.)
  it('POST then DELETE /spec/includes records the decision without re-curating (OSS)', async () => {
    seedCorpus([]);
    const add = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/includes`)
      .send({ ref: 'docs/v1.md' })
      .expect(200);
    expect(add.body.manualIncludes).toContain('docs/v1.md');
    // No corpus in the ack — the client keeps its optimistic row move until the next Scan.
    expect(add.body.corpus).toBeUndefined();
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();

    const del = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/includes`)
      .send({ ref: 'docs/v1.md' })
      .expect(200);
    expect(del.body.manualIncludes).toEqual([]);
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();
  });

  it('POST then DELETE /spec/excludes records the decision without re-curating (OSS)', async () => {
    seedCorpus([]);
    const add = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(add.body.manualExcludes).toContain('docs/v2.md');
    expect(add.body.corpus).toBeUndefined();
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();

    const del = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(del.body.manualExcludes).toEqual([]);
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();
  });

  it('GET /spec/staleness → decisionsPending true after a decision, false after a fresh scan', async () => {
    seedCorpus([]); // corpus generatedAt = 2026-01-01
    // No decisions yet → nothing pending.
    const before = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(before.body.decisionsPending).toBe(false);

    // Recording a decision writes decisions.json (now) → newer than the corpus.
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    const pending = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(pending.body.decisionsPending).toBe(true);

    // A fresh scan re-curates with a newer generatedAt → the pending signal clears.
    const corpusFile = path.join(fixture.repoPath, '.truecourse', 'specs', 'corpus.json');
    const corpus = JSON.parse(fs.readFileSync(corpusFile, 'utf8'));
    corpus.generatedAt = '2099-01-01T00:00:00Z';
    fs.writeFileSync(corpusFile, JSON.stringify(corpus));
    const cleared = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(cleared.body.decisionsPending).toBe(false);
  });

  it('force-exclude clears a force-include for the same doc (mutually exclusive)', async () => {
    seedCorpus([]);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/includes`)
      .send({ ref: 'docs/v1.md' })
      .expect(200);
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v1.md' })
      .expect(200);
    expect(res.body.manualExcludes).toContain('docs/v1.md');
    expect(res.body.manualIncludes ?? []).not.toContain('docs/v1.md');
  });

  it('GET /spec/corpus exposes manualIncludes + skippedDocs', async () => {
    seedCorpus([]);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/includes`)
      .send({ ref: 'docs/v1.md' })
      .expect(200);
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(200);
    expect(res.body.manualIncludes).toContain('docs/v1.md');
    expect(res.body.corpus.skippedDocs).toContainEqual({ ref: 'docs/archived.md', reason: 'archived directory' });
  });

});

// DB mode (hosted): repo.path is a repoKey, the corpus lives in the store, and
// there is no local git tree. The decision routes must NOT gate on git and must
// NOT re-curate (a decision is not a corpus change); only when a decision leaves
// the stored corpus conflict-free do they unblock a stalled guard generate.
//
// This mirrors LIVE EE wiring: a hosted SPEC store is installed (decisions writes +
// corpus reads flow through it) and NO contract store, so the file-default contract
// flag stays TRUE. The spec routes therefore key their edition check on the SPEC
// store — the store EE actually installs.
describe('corpus routes — EE (stored corpus, no live tree)', () => {
  let app: Express;
  let fixture: TestFixture;
  let memSpec: SpecStore;

  // Seed the hosted spec store's current corpus (the store the DB-mode routes read
  // through), not the working tree — a hosted repo has no live `corpus.json`.
  // `conflict` flags a v1/v2 disagreement so the repo has ONE open conflict.
  const seedCorpus = (opts: { conflict?: boolean } = {}): void => {
    void memSpec.saveSpec(
      { repoKey: fixture.repoPath, commitSha: 'seed' },
      'corpus',
      {
        version: 3,
        generatedAt: '2026-01-01T00:00:00Z',
        docs: [
          { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'] },
          { ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'] },
        ],
        areas: [
          {
            id: 'booking/appointments',
            product: 'booking',
            concern: 'appointments',
            docRefs: ['docs/v1.md', 'docs/v2.md'],
            overlaps: opts.conflict
              ? [
                  {
                    docs: ['docs/v1.md', 'docs/v2.md'],
                    note: '24h vs 48h',
                    sections: [
                      { doc: 'docs/v1.md', heading: 'Cancellation' },
                      { doc: 'docs/v2.md', heading: 'Cancellation policy' },
                    ],
                  },
                ]
              : [],
          },
        ],
        relations: [],
        skippedDocs: [{ ref: 'docs/dropped.md', reason: 'changelog' }],
      },
    );
  };

  // The verdict that resolves the seeded v1/v2 dispute.
  const VERDICT = {
    docA: 'docs/v1.md',
    anchorA: 'Cancellation',
    docB: 'docs/v2.md',
    anchorB: 'Cancellation policy',
    verdict: 'b',
  };

  // A guard store whose generate report is `status`. `open-conflicts` = a generate
  // that stalled BLOCKED before authoring scenarios (the unblock trigger); anything
  // else = a healthy report that must NOT re-trigger. `null` = no report at all.
  const stubGuardReport = (status: GuardGenerateReport['status'] | null): void => {
    setGuardStore({
      materializesInPlace: false,
      readGuardResult: async () =>
        status === null ? null : ({ status } as unknown as GuardGenerateReport),
    } as unknown as GuardStore);
  };

  // Anchor the hosted repo's baseline (the analyze LATEST commit) at `commit` —
  // the anchor the repo-level guard-report read resolves, never "newest".
  const seedAnalyzeBaseline = (commit: string): Promise<void> =>
    writeLatest(fixture.repoPath, {
      head: 'run.json',
      analysis: {
        id: 'r1',
        createdAt: '2026-07-01T00:00:00.000Z',
        branch: 'main',
        commitHash: commit,
        architecture: 'monolith',
        metadata: { isDiffAnalysis: false },
        status: 'completed',
      },
      graph: {
        services: [],
        serviceDependencies: [],
        layers: [],
        modules: [],
        methods: [],
        moduleDeps: [],
        methodDeps: [],
        databases: [],
        databaseConnections: [],
        flows: [],
      },
      violations: [],
    });

  beforeEach(async () => {
    fixture = await setupTestFixture(); // deliberately NOT git-initialized
    // Live DB-mode wiring: a hosted SPEC store installed, NO contract store (the
    // file-default contract flag stays TRUE). The spec routes must key their
    // edition check on the spec store — mirroring what boot actually installs.
    memSpec = makeMemSpecStore();
    setSpecStore(memSpec);
    vi.mocked(curateInProcess).mockClear();
    app = createTestApp();
  });
  afterEach(async () => {
    resetSpecStore();
    resetGuardStore();
    setGuardGenerateEnqueue(null);
    setBackgroundTaskRunner(null);
    await teardownTestFixture(fixture.project.slug);
  });

  it('POST /spec/excludes persists the decision without a git gate, a re-curate or a repo-scope job', async () => {
    const tasks: BackgroundTask[] = [];
    setBackgroundTaskRunner(async (t) => {
      tasks.push(t);
    });
    seedCorpus();
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200); // was 400 "not a git repository" before the fix
    expect(res.body.manualExcludes).toContain('docs/v2.md');
    expect(res.body).not.toHaveProperty('corpus'); // the ack, not a re-curated corpus
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();
    expect(tasks).toEqual([]);
  });

  it('DELETE /spec/excludes restores the doc', async () => {
    seedCorpus();
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    const del = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(del.body.manualExcludes ?? []).not.toContain('docs/v2.md');
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();
  });

  it('a conflict verdict acks the persisted verdicts and never runs a scan', async () => {
    seedCorpus({ conflict: true });
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send(VERDICT)
      .expect(200);
    expect(res.body.conflictResolutions).toHaveLength(1);
    expect(res.body.conflictResolutions[0]).toMatchObject({ docA: 'docs/v1.md', docB: 'docs/v2.md', verdict: 'b' });
    expect(res.body).not.toHaveProperty('corpus');
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();
  });

  // A decision clearing the last conflict must unblock a guard generate that
  // stalled on that conflict: when the repo's current generate report is
  // `open-conflicts`, the installed guard-generate seam fires with the repoKey.
  it('a verdict clearing the last conflict with a BLOCKED (open-conflicts) report enqueues a guard generate', async () => {
    const enqueued: string[] = [];
    setGuardGenerateEnqueue(async (repoKey) => {
      enqueued.push(repoKey);
    });
    seedCorpus({ conflict: true });
    await seedAnalyzeBaseline('basesha1111');
    stubGuardReport('open-conflicts');
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send(VERDICT)
      .expect(200);
    expect(enqueued).toEqual([fixture.repoPath]);
  });

  it('an exclude that removes one side of the last conflict enqueues the guard generate too', async () => {
    const enqueued: string[] = [];
    setGuardGenerateEnqueue(async (repoKey) => {
      enqueued.push(repoKey);
    });
    seedCorpus({ conflict: true });
    await seedAnalyzeBaseline('basesha1111');
    stubGuardReport('open-conflicts');
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(enqueued).toEqual([fixture.repoPath]);
  });

  it("a newer PR-head 'ok' report never masks the baseline's BLOCKED report — generate still fires", async () => {
    const enqueued: string[] = [];
    setGuardGenerateEnqueue(async (repoKey) => {
      enqueued.push(repoKey);
    });
    seedCorpus({ conflict: true });
    await seedAnalyzeBaseline('basesha1111');
    // Commit-aware guard stub: the BASELINE row is the blocked open-conflicts
    // report; any commit-less ("newest by createdAt") read sees a PR regen's ok
    // report instead — which would wrongly skip the unblock generate forever.
    setGuardStore({
      materializesInPlace: false,
      readGuardResult: async (_repoKey: string, commitSha?: string) =>
        ({
          status: commitSha === 'basesha1111' ? 'open-conflicts' : 'ok',
        }) as unknown as GuardGenerateReport,
    } as unknown as GuardStore);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send(VERDICT)
      .expect(200);
    expect(enqueued).toEqual([fixture.repoPath]);
  });

  it('does NOT enqueue a guard generate when the report is healthy (not open-conflicts)', async () => {
    const enqueued: string[] = [];
    setGuardGenerateEnqueue(async (repoKey) => {
      enqueued.push(repoKey);
    });
    seedCorpus({ conflict: true });
    await seedAnalyzeBaseline('basesha1111');
    stubGuardReport('ok');
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send(VERDICT)
      .expect(200);
    expect(enqueued).toEqual([]);
  });

  it('does NOT enqueue a guard generate while conflicts remain (guard report never consulted)', async () => {
    const enqueued: string[] = [];
    setGuardGenerateEnqueue(async (repoKey) => {
      enqueued.push(repoKey);
    });
    let guardRead = false;
    setGuardStore({
      materializesInPlace: false,
      readGuardResult: async () => {
        guardRead = true;
        return { status: 'open-conflicts' } as unknown as GuardGenerateReport;
      },
    } as unknown as GuardStore);
    seedCorpus({ conflict: true });
    // Excluding a doc outside the dispute leaves the v1/v2 conflict open.
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/other.md' })
      .expect(200);
    expect(enqueued).toEqual([]);
    expect(guardRead).toBe(false); // hot path stays cheap — the store is never read
  });

  it('a BLOCKED report with no guard-generate seam installed is a no-op, not an error', async () => {
    // No setGuardGenerateEnqueue → getGuardGenerateEnqueue() is null; the route must
    // simply skip it and still answer 200.
    const tasks: BackgroundTask[] = [];
    setBackgroundTaskRunner(async (t) => {
      tasks.push(t);
    });
    seedCorpus({ conflict: true });
    await seedAnalyzeBaseline('basesha1111');
    stubGuardReport('open-conflicts');
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send(VERDICT)
      .expect(200);
    expect(tasks).toEqual([]);
  });

  // The Rescan dot: an include/exclude the stored corpus has not absorbed pends
  // (a Scan would materialize it); a verdict derives live and never does.
  it('GET /spec/staleness reports decisionsPending for an unabsorbed exclude, not for a verdict', async () => {
    seedCorpus({ conflict: true });
    const before = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(before.body.decisionsPending).toBe(false);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send(VERDICT)
      .expect(200);
    const afterVerdict = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(afterVerdict.body.decisionsPending).toBe(false);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    const afterExclude = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(afterExclude.body.decisionsPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Doc-content staleness (docsChanged) — the "fix the doc itself"
// resolution path: an external edit bumps the kept doc's mtime past the corpus
// `generatedAt` and lights the Rescan dot. (There is no in-app doc editor.)
// ---------------------------------------------------------------------------

describe('spec docs-content staleness', () => {
  let app: Express;
  let fixture: TestFixture;

  const specsDir = () => path.join(fixture.repoPath, '.truecourse', 'specs');
  const DOC = 'docs/spec.md';
  const DOC_BODY = '## rm\nrm archives the task.\n\n## keep\nkeep does nothing.\n';

  // Seed a one-doc corpus whose `generatedAt` is AFTER the doc's (back-dated) mtime,
  // so the docs-content signal starts clean and only flips when the doc is edited.
  const seed = (generatedAt = '2026-06-01T00:00:00Z'): void => {
    fs.mkdirSync(specsDir(), { recursive: true });
    fs.writeFileSync(
      path.join(specsDir(), 'corpus.json'),
      JSON.stringify({
        version: 3,
        generatedAt,
        docs: [{ ref: DOC, kind: 'spec', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/persistence'] }],
        areas: [{ id: 'core/persistence', product: 'core', concern: 'persistence', docRefs: [DOC], overlaps: [] }],
        relations: [],
        skippedDocs: [],
      }),
    );
    fs.mkdirSync(path.join(fixture.repoPath, 'docs'), { recursive: true });
    fs.writeFileSync(path.join(fixture.repoPath, DOC), DOC_BODY);
    const old = new Date('2026-01-01T00:00:00Z');
    fs.utimesSync(path.join(fixture.repoPath, DOC), old, old);
  };

  beforeEach(async () => {
    fixture = await setupTestFixture();
    gitInit(fixture.repoPath);
    app = createTestApp();
  });
  afterEach(async () => {
    setBackgroundTaskRunner(null);
    await teardownTestFixture(fixture.project.slug);
  });

  it('staleness docsChanged is false with a fresh corpus, true after a kept doc is edited on disk', async () => {
    seed();
    const before = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(before.body.docsChanged).toBe(false);
    expect(before.body.decisionsPending).toBe(false);

    // Edit the doc in the working tree (user's own editor) — mtime bumps to now.
    fs.writeFileSync(
      path.join(fixture.repoPath, DOC),
      DOC_BODY.replace('rm archives the task.', 'rm permanently deletes the task.'),
    );

    const after = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(after.body.docsChanged).toBe(true);
  });

  // A web source's pages are not in the corpus's doc list until the scan that
  // follows the add, so the kept-doc loop alone can never see one arrive.
  describe('web sources', () => {
    const staleness = async (): Promise<{ docsChanged: boolean }> =>
      (await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200)).body;

    /** Age the snapshot the way a checkout the last scan already read would be. */
    const ageSnapshot = (): void => {
      const old = new Date('2026-01-01T00:00:00Z');
      const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          fs.utimesSync(full, old, old);
        }
        fs.utimesSync(dir, old, old);
      };
      walk(sourcesDirPath(fixture.repoPath));
      fs.utimesSync(sourcesFilePath(fixture.repoPath), old, old);
    };

    it('an added/refreshed source lights docsChanged, and the next scan clears it', async () => {
      seed();
      seedSource(fixture.repoPath);
      ageSnapshot();
      expect((await staleness()).docsChanged).toBe(false);

      // `spec source refresh` rewrites the pages it fetched and the registry.
      seedSource(fixture.repoPath);
      expect((await staleness()).docsChanged).toBe(true);

      // The scan that follows stamps `generatedAt` after reading the snapshot.
      await new Promise((resolve) => setTimeout(resolve, 10));
      seed(new Date().toISOString());
      expect((await staleness()).docsChanged).toBe(false);
    });

    it('a page removed from the snapshot tree lights docsChanged', async () => {
      seed();
      const source = seedSource(fixture.repoPath);
      ageSnapshot();
      expect((await staleness()).docsChanged).toBe(false);

      // `spec source remove` (or a refresh that unlists a page) deletes files —
      // nothing newer is left behind, only the directory's own mtime moves.
      fs.rmSync(path.join(sourceDirPath(fixture.repoPath, source.id), source.docs[0].path));

      expect((await staleness()).docsChanged).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Section-scoped conflict verdicts — POST/DELETE /spec/conflict-resolution
// ---------------------------------------------------------------------------

describe('conflict-resolution routes', () => {
  let app: Express;
  let fixture: TestFixture;

  const seedCorpus = (): void => {
    const specs = path.join(fixture.repoPath, '.truecourse', 'specs');
    fs.mkdirSync(specs, { recursive: true });
    fs.writeFileSync(
      path.join(specs, 'corpus.json'),
      JSON.stringify({
        version: 3,
        generatedAt: '2026-01-01T00:00:00Z',
        docs: [
          { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'] },
          { ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'] },
        ],
        areas: [
          {
            id: 'booking/appointments',
            product: 'booking',
            concern: 'appointments',
            docRefs: ['docs/v1.md', 'docs/v2.md'],
            overlaps: [
              {
                docs: ['docs/v1.md', 'docs/v2.md'],
                note: '24h vs 48h',
                sections: [
                  { doc: 'docs/v1.md', heading: 'Cancellation' },
                  { doc: 'docs/v2.md', heading: 'Cancellation policy' },
                ],
              },
            ],
          },
        ],
        relations: [],
        skippedDocs: [],
      }),
    );
  };

  const verdict = {
    docA: 'docs/v1.md',
    anchorA: 'Cancellation',
    docB: 'docs/v2.md',
    anchorB: 'Cancellation policy',
    verdict: 'a' as const,
  };

  beforeEach(async () => {
    fixture = await setupTestFixture();
    gitInit(fixture.repoPath);
    vi.mocked(curateInProcess).mockClear();
    app = createTestApp();
  });
  afterEach(async () => {
    setBackgroundTaskRunner(null);
    await teardownTestFixture(fixture.project.slug);
  });

  it('POST records a verdict without re-curating (OSS ack), and GET /spec/corpus exposes it', async () => {
    seedCorpus();
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send(verdict)
      .expect(200);
    // OSS ack: the persisted verdicts only (no corpus), and no re-curate.
    expect(res.body.conflictResolutions).toHaveLength(1);
    expect(res.body.conflictResolutions[0]).toMatchObject({ docA: 'docs/v1.md', verdict: 'a' });
    expect(res.body.conflictResolutions[0].resolvedAt).toBeTruthy();
    expect(res.body.corpus).toBeUndefined();
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();

    // The corpus payload now carries the verdict so the client re-derives resolution.
    const corpus = await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(200);
    expect(corpus.body.conflictResolutions).toHaveLength(1);
  });

  it('DELETE removes the verdict by dispute identity (OSS ack)', async () => {
    seedCorpus();
    await request(app).post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`).send(verdict).expect(200);
    const del = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send({ docA: 'docs/v1.md', anchorA: 'Cancellation', docB: 'docs/v2.md', anchorB: 'Cancellation policy' })
      .expect(200);
    expect(del.body.conflictResolutions).toEqual([]);
  });

  it('recording a verdict lights the decisionsPending staleness signal', async () => {
    seedCorpus();
    const before = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(before.body.decisionsPending).toBe(false);
    await request(app).post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`).send(verdict).expect(200);
    const after = await request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);
    expect(after.body.decisionsPending).toBe(true);
  });

  it('400s on a missing/equal doc pair or a bad verdict', async () => {
    seedCorpus();
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send({ docA: 'docs/v1.md', anchorA: null, docB: 'docs/v1.md', anchorB: null, verdict: 'a' })
      .expect(400);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send({ docA: 'docs/v1.md', anchorA: null, docB: 'docs/v2.md', anchorB: null, verdict: 'bogus' })
      .expect(400);
  });
});

// ---------------------------------------------------------------------------
// Web spec sources — GET/POST /spec/sources, preview, refresh, DELETE.
//
// The engine has its own suite (tests/spec-consolidator); these assert the HTTP
// shape: the view the dashboard reads, the typed engine failures as clean 4xx,
// the completion event that lights the Rescan dot, and the corpus/doc enrichment
// that makes a fetched page readable in the UI. The network never leaves the
// machine — every request goes to the local llms.txt fixture site.
// ---------------------------------------------------------------------------

describe('web source routes', () => {
  let app: Express;
  let fixture: TestFixture;
  let site: FixtureSite;

  const api = (path: string): string => `/api/repos/${fixture.project.slug}${path}`;

  beforeEach(async () => {
    fixture = await setupTestFixture();
    site = await startDocsSite();
    vi.mocked(emitSpecComplete).mockClear();
    app = createTestApp();
  });
  afterEach(async () => {
    await site.close();
    await teardownTestFixture(fixture.project.slug);
  });

  it('GET /spec/sources → [] before anything is registered, then the registry view', async () => {
    const empty = await request(app).get(api('/spec/sources')).expect(200);
    expect(empty.body.sources).toEqual([]);

    const seeded = seedSource(fixture.repoPath);
    const res = await request(app).get(api('/spec/sources')).expect(200);
    expect(res.body.sources).toEqual([
      {
        id: seeded.id,
        title: 'Strapi Docs',
        llmsTxtUrl: seeded.llmsTxtUrl,
        fetchedAt: seeded.fetchedAt,
        docCount: 3,
        skipped: [],
      },
    ]);
    // The per-page array (hundreds of entries on a real site) never ships.
    expect(res.body.sources[0].docs).toBeUndefined();
  });

  it('GET /spec/sources/:sourceId → the source WITH its pages; 404 for an unknown id', async () => {
    const seeded = seedSource(fixture.repoPath);
    const res = await request(app).get(api(`/spec/sources/${seeded.id}`)).expect(200);

    expect(res.body.source).toMatchObject({ id: seeded.id, title: 'Strapi Docs', docCount: 3 });
    // Every page, by the ref the doc viewer opens it with.
    expect(res.body.source.docs).toEqual(
      seeded.docs.map((doc) => ({
        ref: `.truecourse/specs/sources/${seeded.id}/${doc.path}`,
        path: doc.path,
        title: doc.title,
        url: doc.url,
      })),
    );

    const missing = await request(app).get(api('/spec/sources/gone')).expect(404);
    expect(missing.body.error).toContain('gone');
  });

  it('POST /spec/sources/preview → what an add would fetch, writing nothing', async () => {
    const res = await request(app)
      .post(api('/spec/sources/preview'))
      .send({ url: llmsTxtUrl(site) })
      .expect(200);
    expect(res.body.title).toBe('Strapi Docs');
    expect(res.body.totalLinks).toBe(9);
    expect(res.body.fetchableLinks).toBe(7);
    expect(res.body.skipped).toContainEqual({
      url: 'https://github.com/strapi/strapi',
      reason: 'external-origin',
    });
    // Preview is a read: no registry, no snapshot.
    expect(fs.existsSync(sourcesFilePath(fixture.repoPath))).toBe(false);
  });

  it('POST /spec/sources/preview → 400 for a URL that is not an llms.txt', async () => {
    const res = await request(app)
      .post(api('/spec/sources/preview'))
      .send({ url: `${site.origin}/cms/quick-start.md` })
      .expect(400);
    expect(res.body.error).toContain('llms.txt');
    // A missing body is the same class of user error, not a 500.
    await request(app).post(api('/spec/sources/preview')).send({}).expect(400);
  });

  it('POST /spec/sources → snapshots the site and completes with kind "sources"', async () => {
    const res = await request(app)
      .post(api('/spec/sources'))
      .send({ url: llmsTxtUrl(site) })
      .expect(200);

    expect(res.body.written).toBe(6);
    expect(res.body.source.docCount).toBe(6);
    expect(res.body.source.title).toBe('Strapi Docs');
    // The HTML-only page is reported, never converted.
    expect(res.body.skipped).toContainEqual({
      url: `${site.origin}/cloud/deployment`,
      reason: 'not-markdown',
      detail: 'content-type: text/html',
    });

    const id = res.body.source.id as string;
    expect(fs.existsSync(path.join(sourceDirPath(fixture.repoPath, id), 'cms/installation.md'))).toBe(true);
    expect(vi.mocked(emitSpecComplete)).toHaveBeenCalledWith(fixture.project.slug, 'sources');
  });

  it('POST /spec/sources → 409 when the site is already registered', async () => {
    await request(app).post(api('/spec/sources')).send({ url: llmsTxtUrl(site) }).expect(200);
    const res = await request(app)
      .post(api('/spec/sources'))
      .send({ url: llmsTxtUrl(site) })
      .expect(409);
    expect(res.body.error).toContain('already registered');
  });

  it('POST /spec/sources/:sourceId/refresh → the reconciliation with the site', async () => {
    const added = await request(app)
      .post(api('/spec/sources'))
      .send({ url: llmsTxtUrl(site) })
      .expect(200);
    const id = added.body.source.id as string;
    vi.mocked(emitSpecComplete).mockClear();

    // One page's content moved on; everything else is byte-identical.
    site.routes['/cms/installation.md'] = { body: `${INSTALLATION_MD}\n## Upgrading\n\nRun the codemod.\n` };
    const res = await request(app).post(api(`/spec/sources/${id}/refresh`)).expect(200);

    expect(res.body.results).toHaveLength(1);
    const [result] = res.body.results;
    expect(result.changed).toEqual(['cms/installation.md']);
    expect(result.added).toEqual([]);
    expect(result.removed).toEqual([]);
    expect(result.unchanged).toBe(5);
    expect(result.source.docCount).toBe(6);
    expect(vi.mocked(emitSpecComplete)).toHaveBeenCalledWith(fixture.project.slug, 'sources');
  });

  it('POST /spec/sources/refresh → every registered source; [] when none are', async () => {
    const empty = await request(app).post(api('/spec/sources/refresh')).expect(200);
    expect(empty.body.results).toEqual([]);
    // Nothing ran, so no completion event fires.
    expect(vi.mocked(emitSpecComplete)).not.toHaveBeenCalled();

    await request(app).post(api('/spec/sources')).send({ url: llmsTxtUrl(site) }).expect(200);
    const res = await request(app).post(api('/spec/sources/refresh')).expect(200);
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].unchanged).toBe(6);
  });

  it('refresh of an unknown id → 404 naming the registered ones', async () => {
    seedSource(fixture.repoPath, { id: 'docs.strapi.io' });
    const res = await request(app).post(api('/spec/sources/nope/refresh')).expect(404);
    expect(res.body.error).toContain('nope');
    expect(res.body.error).toContain('Registered: docs.strapi.io');
  });

  it('DELETE /spec/sources/:sourceId → drops the snapshot + the entry; 404 for an unknown id', async () => {
    const source = seedSource(fixture.repoPath);
    const res = await request(app).delete(api(`/spec/sources/${source.id}`)).expect(200);
    expect(res.body.removed.id).toBe(source.id);
    expect(fs.existsSync(sourceDirPath(fixture.repoPath, source.id))).toBe(false);
    expect(readSourcesFile(fixture.repoPath).sources).toEqual([]);
    expect(vi.mocked(emitSpecComplete)).toHaveBeenCalledWith(fixture.project.slug, 'sources');

    const missing = await request(app).delete(api('/spec/sources/gone')).expect(404);
    expect(missing.body.error).toContain('nothing is registered yet');
  });

  // The corpus payload's display enrichment: a snapshot ref is a real file path,
  // unreadable in a list, so the UI needs the site it came from and the page it
  // mirrors. Repo-local docs must come back untouched.
  describe('corpus + doc enrichment', () => {
    const seedCorpusWithSource = (source: { id: string }): void => {
      const specs = path.join(fixture.repoPath, '.truecourse', 'specs');
      fs.mkdirSync(specs, { recursive: true });
      fs.writeFileSync(
        path.join(specs, 'corpus.json'),
        JSON.stringify({
          version: 3,
          generatedAt: '2026-01-01T00:00:00Z',
          docs: [
            { ref: 'docs/booking.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'] },
            {
              ref: `.truecourse/specs/sources/${source.id}/cms/installation.md`,
              kind: 'guide',
              lastTouched: '2026-01-01T00:00:00Z',
              areaTags: ['cms/install'],
            },
          ],
          areas: [],
          skippedDocs: [
            { ref: `.truecourse/specs/sources/${source.id}/cms/api/rest.md`, reason: 'not about this repo' },
          ],
        }),
      );
    };

    it('tags web-source docs with their source + original page URL', async () => {
      const source = seedSource(fixture.repoPath);
      seedCorpusWithSource(source);

      const res = await request(app).get(api('/spec/corpus')).expect(200);
      const [repoDoc, webDoc] = res.body.corpus.docs;
      expect(repoDoc).toEqual({
        ref: 'docs/booking.md',
        kind: 'prd',
        lastTouched: '2026-01-01T00:00:00Z',
        areaTags: ['booking/appointments'],
      });
      expect(webDoc.origin).toBe('web');
      expect(webDoc.sourceId).toBe(source.id);
      expect(webDoc.sourceTitle).toBe('Strapi Docs');
      expect(webDoc.url).toBe(`https://${source.id}/cms/installation.md`);
      // A dropped page is shown in the same list, so it is enriched too.
      expect(res.body.corpus.skippedDocs[0].origin).toBe('web');
      expect(res.body.corpus.skippedDocs[0].sourceTitle).toBe('Strapi Docs');
    });

    it('still tags a page whose source is gone, from the ref alone', async () => {
      const source = seedSource(fixture.repoPath);
      seedCorpusWithSource(source);
      await request(app).delete(api(`/spec/sources/${source.id}`)).expect(200);

      const res = await request(app).get(api('/spec/corpus')).expect(200);
      const webDoc = res.body.corpus.docs[1];
      expect(webDoc.origin).toBe('web');
      expect(webDoc.sourceId).toBe(source.id);
      expect(webDoc.sourceTitle).toBeUndefined();
    });

    it('GET /spec/doc serves a snapshot ref (it is a real file in the tree)', async () => {
      const source = seedSource(fixture.repoPath);
      const res = await request(app)
        .get(api('/spec/doc'))
        .query({ ref: `.truecourse/specs/sources/${source.id}/cms/installation.md` })
        .expect(200);
      expect(res.body.content).toContain('# Installation');
    });
  });
});
