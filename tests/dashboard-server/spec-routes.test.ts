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

// Include/exclude routes re-curate server-side. The curate engine has its own
// suite (tests/spec-consolidator), so stub it to a no-op here — leaving the
// seeded corpus.json intact — and assert the routes INVOKE it (the recheck is
// server-driven, not client-driven).
vi.mock('@truecourse/core/commands/spec-in-process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@truecourse/core/commands/spec-in-process')>();
  return {
    ...actual,
    curateInProcess: vi.fn(async () => ({ noChanges: false })),
    // EE include/exclude re-curates the stored corpus in-process (its own suite in
    // tests/core covers the docSource wiring). Stub it here so the route test asserts
    // the route INVOKES it.
    recurateStoredCorpus: vi.fn(async () => null),
  };
});

import { createApp } from '../../apps/dashboard/server/src/app';
import { curateInProcess, recurateStoredCorpus } from '@truecourse/core/commands/spec-in-process';
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
import type { CuratedCorpus } from '@truecourse/spec-consolidator';
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
    app = createApp({ serveStatic: false });
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
    app = createApp({ serveStatic: false });
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

// EE (hosted): repo.path is a repoKey, the corpus lives in the store, and there
// is no local git tree. The decision routes must NOT gate on git. They re-curate
// the stored corpus in-process (the SAME curate OSS runs, docs sourced through the
// repo-doc seam), and — only if that leaves the spec conflict-free — chain the
// baseline re-scan and the blocked guard generate.
//
// This mirrors LIVE EE wiring: a hosted SPEC store is installed (decisions writes +
// corpus reads flow through it) and NO contract store, so the file-default contract
// flag stays TRUE. The spec routes therefore key their edition check on the SPEC
// store — the store EE actually installs.
describe('corpus routes — EE (stored corpus, no live tree)', () => {
  let app: Express;
  let fixture: TestFixture;
  let memSpec: SpecStore;

  // Seed the hosted spec store's current corpus (the store the EE routes read
  // through), not the working tree — EE has no live `corpus.json`.
  const seedCorpus = (): void => {
    void memSpec.saveSpec(
      { repoKey: fixture.repoPath, commitSha: 'seed' },
      'corpus',
      {
        version: 3,
        generatedAt: '2026-01-01T00:00:00Z',
        docs: [{ ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'] }],
        areas: [{ id: 'booking/appointments', product: 'booking', concern: 'appointments', docRefs: ['docs/v2.md'], overlaps: [] }],
        relations: [],
        skippedDocs: [],
      },
    );
  };

  // Stub the in-process re-curate's outcome (its own docSource wiring is covered in
  // tests/core). `openConflicts` drives the regenerate-or-not decision.
  const stubRecurate = (openConflicts: number): void => {
    vi.mocked(recurateStoredCorpus).mockResolvedValueOnce({
      corpus: { docs: [{ ref: 'docs/keep.md' }] } as unknown as CuratedCorpus,
      openConflicts,
    });
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
    // Live EE wiring: a hosted SPEC store installed, NO contract store (the
    // file-default contract flag stays TRUE). The spec routes must key their
    // edition check on the spec store — mirroring what EE actually installs.
    memSpec = makeMemSpecStore();
    setSpecStore(memSpec);
    vi.mocked(recurateStoredCorpus).mockReset();
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    resetSpecStore();
    resetGuardStore();
    setGuardGenerateEnqueue(null);
    setBackgroundTaskRunner(null);
    await teardownTestFixture(fixture.project.slug);
  });

  // LIVE EE wiring reproduction (the regression this suite missed): EE installs a
  // hosted SPEC store and — since the verify-gate retirement — NO contract store, so
  // the file-default contract flag is TRUE while the spec store is hosted (the fixture
  // wires exactly that). The spec routes must key their edition check on the SPEC
  // store: clearing the last conflict with a BLOCKED (open-conflicts) generate report
  // must re-curate AND fire the guard-generate seam.
  it('LIVE EE wiring (hosted spec store, no contract store): clearing the last conflict re-curates and fires guard generate', async () => {
    const enqueued: string[] = [];
    setGuardGenerateEnqueue(async (repoKey) => {
      enqueued.push(repoKey);
    });
    seedCorpus();
    await seedAnalyzeBaseline('basesha1111');
    stubGuardReport('open-conflicts');
    stubRecurate(0);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(vi.mocked(recurateStoredCorpus)).toHaveBeenCalledWith(fixture.repoPath);
    expect(enqueued).toEqual([fixture.repoPath]);
  });

  it('POST /spec/excludes re-curates the stored corpus (no git gate) and enqueues no repo-scope job', async () => {
    const tasks: BackgroundTask[] = [];
    setBackgroundTaskRunner(async (t) => {
      tasks.push(t);
    });
    seedCorpus();
    stubRecurate(0);
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200); // was 400 "not a git repository" before the fix
    expect(res.body.manualExcludes).toContain('docs/v2.md');
    expect(vi.mocked(recurateStoredCorpus)).toHaveBeenCalledWith(fixture.repoPath);
    // Repo-scope decisions chain the baseline re-scan / guard generate seams, never
    // the background queue — that carries PR-scoped re-gates only.
    expect(tasks).toEqual([]);
  });

  it('POST /spec/excludes re-curates while conflicts remain', async () => {
    const tasks: BackgroundTask[] = [];
    setBackgroundTaskRunner(async (t) => {
      tasks.push(t);
    });
    seedCorpus();
    stubRecurate(2);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(vi.mocked(recurateStoredCorpus)).toHaveBeenCalledWith(fixture.repoPath);
    expect(tasks).toEqual([]); // conflicts remain → cheap re-curate only
  });

  it('DELETE /spec/excludes restores the doc (re-curate; chaining still gated on conflict-free)', async () => {
    const tasks: BackgroundTask[] = [];
    setBackgroundTaskRunner(async (t) => {
      tasks.push(t);
    });
    seedCorpus();
    stubRecurate(0);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    stubRecurate(0);
    const del = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(del.body.manualExcludes ?? []).not.toContain('docs/v2.md');
  });

  // A decision clearing the last conflict must ALSO unblock a guard generate that
  // stalled on that conflict: when the repo's current generate report is
  // `open-conflicts`, the installed guard-generate seam fires with the repoKey.
  it('clearing the last conflict with a BLOCKED (open-conflicts) generate report enqueues a guard generate', async () => {
    const enqueued: string[] = [];
    setGuardGenerateEnqueue(async (repoKey) => {
      enqueued.push(repoKey);
    });
    seedCorpus();
    await seedAnalyzeBaseline('basesha1111');
    stubGuardReport('open-conflicts');
    stubRecurate(0);
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
    seedCorpus();
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
    stubRecurate(0);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(enqueued).toEqual([fixture.repoPath]);
  });

  it('does NOT enqueue a guard generate when the report is healthy (not open-conflicts)', async () => {
    const enqueued: string[] = [];
    setGuardGenerateEnqueue(async (repoKey) => {
      enqueued.push(repoKey);
    });
    seedCorpus();
    await seedAnalyzeBaseline('basesha1111');
    stubGuardReport('ok');
    stubRecurate(0);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
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
    seedCorpus();
    stubRecurate(2); // conflicts remain
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(enqueued).toEqual([]);
    expect(guardRead).toBe(false); // hot path stays cheap — the store is never read
  });

  it('a BLOCKED report with no guard-generate seam installed (OSS) is a no-op, not an error', async () => {
    // No setGuardGenerateEnqueue → getGuardGenerateEnqueue() is null; the route must
    // simply skip it and still answer 200.
    const tasks: BackgroundTask[] = [];
    setBackgroundTaskRunner(async (t) => {
      tasks.push(t);
    });
    seedCorpus();
    await seedAnalyzeBaseline('basesha1111');
    stubGuardReport('open-conflicts');
    stubRecurate(0);
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/excludes`)
      .send({ ref: 'docs/v2.md' })
      .expect(200);
    expect(tasks).toEqual([]);
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
    app = createApp({ serveStatic: false });
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
    app = createApp({ serveStatic: false });
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
