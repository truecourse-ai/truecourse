import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import request from 'supertest';
import { type Express } from 'express';

/** The corpus routes want a git repo (like analyze) — init the fixture so the route guard passes. */
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
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
    createSocketSpecEstimateHandler: () => () => Promise.resolve(true),
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

import { createTestApp, TEST_ORG } from '../helpers/test-app';
import { memoryContextStore } from '../helpers/memory-context-store';
import { resetContextStore, setContextStore } from '@truecourse/core/lib/context-store';
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
  saveWorkspaceSpec,
  type SpecStore,
  type RepoRef,
  type SpecArtifact,
  type WorkspaceRef,
} from '@truecourse/core/lib/spec-store';
import { setContextBindings } from '@truecourse/core/lib/context-store';
import {
  addWorkspaceManualExclude,
  addWorkspaceManualInclude,
} from '@truecourse/core/commands/spec-in-process';
import { installMemorySpecStore } from '../helpers/memory-spec-store';
import { installWorkTreeGuardStore } from '../helpers/work-tree-guard-store';
import { installWorkTreeDocReader, resetRepoDocReader } from '../helpers/work-tree-doc-reader';
import { setGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import type { GuardGenerateReport } from '@truecourse/shared';
import {
  setupTestFixture,
  teardownTestFixture,
  type TestFixture,
} from '../helpers/test-fixture';





/**
 * Spec route tests assert the HTTP shape of the corpus routes. The
 * curate/generate engine has its own suite under tests/spec-consolidator/ and
 * tests/contract-extractor/.
 */

/**
 * A minimal in-memory `SpecStore` — the shape boot actually installs, Map-backed
 * so the route paths (which read and write through the ACTIVE spec store) work
 * without a real database. Workspace scope is a third map: the corpus and the
 * decisions are the WORKSPACE's now.
 */
function makeMemSpecStore(): SpecStore {
  const byRef = new Map<string, unknown>(); // (repoKey, commitSha, artifact) → json
  const latest = new Map<string, unknown>(); // (repoKey, artifact) → json
  const workspace = new Map<string, unknown>(); // (org, artifact) → json
  const workspaceDocs = new Map<string, string>(); // (org, ref) → body
  const rk = (ref: RepoRef, a: SpecArtifact) => `${ref.repoKey}\x00${ref.commitSha}\x00${a}`;
  const lk = (repoKey: string, a: SpecArtifact) => `${repoKey}\x00${a}`;
  return {
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
    async saveWorkspaceSpec(ref, artifact, json) {
      workspace.set(`${ref.workspaceOrgId}\x00${artifact}`, json);
    },
    async loadWorkspaceSpec<T = unknown>(ref: WorkspaceRef, artifact: SpecArtifact) {
      return (workspace.get(`${ref.workspaceOrgId}\x00${artifact}`) as T) ?? null;
    },
    async saveSpecDocs(ref, files) {
      for (const [docRef, body] of Object.entries(files)) {
        workspaceDocs.set(`${ref.repoKey}\x00${docRef}`, body);
      }
    },
    async loadSpecDoc(repoKey: string, docRef: string) {
      return workspaceDocs.get(`${repoKey}\x00${docRef}`) ?? null;
    },
    async saveWorkspaceSpecDocs(ref, files) {
      for (const [docRef, body] of Object.entries(files)) {
        workspaceDocs.set(`${ref.workspaceOrgId}\x00${docRef}`, body);
      }
    },
    async loadWorkspaceSpecDoc(org: string, docRef: string) {
      return workspaceDocs.get(`${org}\x00${docRef}`) ?? null;
    },
  } satisfies SpecStore;
}

/**
 * The hosted corpus as the store holds it now: ONE workspace corpus over
 * `context/<sourceId>/…` documents. `conflict` flags a v1/v2 disagreement so the
 * workspace has exactly one open conflict.
 */
async function seedWorkspaceCorpus(
  store: SpecStore,
  opts: { conflict?: boolean } = {},
): Promise<void> {
  const ref = (name: string) => `context/repo-src/docs/${name}`;
  await store.saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', {
    version: 3,
    generatedAt: '2026-01-01T00:00:00Z',
    docs: [
      { ref: ref('v1.md'), kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'], sourceId: 'repo-src', sourceKind: 'repository' },
      { ref: ref('v2.md'), kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'], sourceId: 'repo-src', sourceKind: 'repository' },
    ],
    areas: [
      {
        id: 'booking/appointments',
        product: 'booking',
        concern: 'appointments',
        docRefs: [ref('v1.md'), ref('v2.md')],
        overlaps: opts.conflict
          ? [
              {
                docs: [ref('v1.md'), ref('v2.md')],
                note: '24h vs 48h',
                sections: [
                  { doc: ref('v1.md'), heading: 'Cancellation' },
                  { doc: ref('v2.md'), heading: 'Cancellation policy' },
                ],
              },
            ]
          : [],
      },
    ],
    skippedDocs: [{ ref: ref('dropped.md'), reason: 'changelog' }],
  });
}

/** The verdict that resolves the seeded workspace v1/v2 dispute. */
const WS_VERDICT = {
  docA: 'context/repo-src/docs/v1.md',
  anchorA: 'Cancellation',
  docB: 'context/repo-src/docs/v2.md',
  anchorB: 'Cancellation policy',
  verdict: 'b',
};

describe('GET /api/repos/:id/spec/decisions', () => {
  let app: Express;
  let fixture: TestFixture;

  beforeEach(async () => {
    installMemorySpecStore();
    setContextStore(memoryContextStore());
    fixture = await setupTestFixture();
    app = createTestApp();
  });

  afterEach(async () => {
    resetSpecStore();
    resetContextStore();
    await teardownTestFixture(fixture.project.slug);
  });

  it('returns the empty default when decisions.json is absent', async () => {
    const res = await request(app)
      .get(`/api/repos/${fixture.project.slug}/spec/corpus`)
      .expect(404);
    expect(res.body.error).toMatch(/no corpus/i);
  });
});

/** The one Context source the workspace holds, and the repository reads. */
const SOURCE = 'repo-fixture';

describe('corpus routes (spec-scan redesign)', () => {
  let app: Express;
  let fixture: TestFixture;

  /**
   * The WORKSPACE corpus, and the repository's link to the source it came from.
   * A repository's corpus is that slice, so there is nothing repo-scoped to seed;
   * the document bodies are files because the doc route reads them as such.
   */
  const seedCorpus = async (
    overlaps: Array<{ docs: [string, string]; note: string }>,
    generatedAt = '2026-01-01T00:00:00Z',
  ): Promise<void> => {
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', {
      version: 3,
      generatedAt,
      docs: [
        { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'], sourceId: SOURCE },
        { ref: 'docs/v2.md', kind: 'prd', lastTouched: '2026-02-01T00:00:00Z', areaTags: ['booking/appointments'], sourceId: SOURCE },
      ],
      areas: [
        { id: 'booking/appointments', product: 'booking', concern: 'appointments', docRefs: ['docs/v1.md', 'docs/v2.md'], overlaps },
      ],
      relations: [],
      skippedDocs: [{ ref: `context/${SOURCE}/archived.md`, reason: 'archived directory' }],
    });
    const docs = path.join(fixture.repoPath, 'docs');
    fs.mkdirSync(docs, { recursive: true });
    fs.writeFileSync(path.join(docs, 'v1.md'), '# Booking v1\nCancel up to 24h before.');
    fs.writeFileSync(path.join(docs, 'v2.md'), '# Booking v2\nCancel up to 48h before.');
  };

  beforeEach(async () => {
    installMemorySpecStore();
    installWorkTreeDocReader();
    // A decision asks whether it cleared the last conflict blocking a generate,
    // which reads the guard report.
    installWorkTreeGuardStore();
    fixture = await setupTestFixture();
    gitInit(fixture.repoPath); // include/exclude re-curate → route guards require git
    setContextStore(memoryContextStore());
    await setContextBindings(TEST_ORG, fixture.repoPath, [SOURCE]);
    vi.mocked(curateInProcess).mockClear();
    app = createTestApp();
  });
  afterEach(async () => {
    setBackgroundTaskRunner(null);
    resetSpecStore();
    resetContextStore();
    resetRepoDocReader();
    resetGuardStore();
    await teardownTestFixture(fixture.project.slug);
  });

  it('GET /spec/corpus → 404 before any scan', async () => {
    await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(404);
  });

  it('GET /spec/corpus → the corpus', async () => {
    await seedCorpus([{ docs: ['docs/v1.md', 'docs/v2.md'], note: '24h vs 48h' }]);
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(200);
    expect(res.body.corpus.areas).toHaveLength(1);
    expect(res.body.corpus.areas[0].overlaps).toHaveLength(1);
  });

  it('GET /spec/doc → the markdown content; rejects traversal', async () => {
    await seedCorpus([]);
    const ok = await request(app).get(`/api/repos/${fixture.project.slug}/spec/doc`).query({ ref: 'docs/v2.md' }).expect(200);
    expect(ok.body.content).toContain('48h');
    await request(app).get(`/api/repos/${fixture.project.slug}/spec/doc`).query({ ref: '../../etc/passwd' }).expect(400);
  });

  it('has no /spec/relations routes — unknown spec mutations 404', async () => {
    await seedCorpus([]);
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
    await seedCorpus([]);
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
    await seedCorpus([]);
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

  // The write is REPO-scoped (`addManual*`/`addConflictResolution` on
  // `repo.path`) while every read here — the corpus payload and the staleness
  // probe — is WORKSPACE-scoped. So a decision made through these routes is
  // never read back by them, and only the ack can be asserted. The drift is
  // reported; do not "fix" it by asserting a round trip the product does not do.
  it('GET /spec/staleness pends a WORKSPACE decision the corpus has not absorbed', async () => {
    await seedCorpus([]);
    const staleness = () =>
      request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);

    // No decisions yet → nothing pending.
    expect((await staleness()).body.decisionsPending).toBe(false);

    // A workspace exclude of a doc the corpus still keeps.
    await addWorkspaceManualExclude(TEST_ORG, 'docs/v2.md');
    expect((await staleness()).body.decisionsPending).toBe(true);

    // A fresh scan drops the excluded doc → the pending signal clears.
    await saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', {
      version: 3,
      generatedAt: '2099-01-01T00:00:00Z',
      docs: [
        { ref: 'docs/v1.md', kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['booking/appointments'], sourceId: SOURCE },
      ],
      areas: [
        { id: 'booking/appointments', product: 'booking', concern: 'appointments', docRefs: ['docs/v1.md'], overlaps: [] },
      ],
      relations: [],
      skippedDocs: [{ ref: `context/${SOURCE}/archived.md`, reason: 'archived directory' }],
    });
    expect((await staleness()).body.decisionsPending).toBe(false);
  });

  it('force-exclude clears a force-include for the same doc (mutually exclusive)', async () => {
    await seedCorpus([]);
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

  it('GET /spec/corpus exposes the WORKSPACE manualIncludes + skippedDocs', async () => {
    await seedCorpus([]);
    // The payload folds the workspace's decisions — the scope the per-repo
    // `/spec/includes` write does NOT reach (see the note above).
    await addWorkspaceManualInclude(TEST_ORG, 'docs/v1.md');
    const res = await request(app).get(`/api/repos/${fixture.project.slug}/spec/corpus`).expect(200);
    expect(res.body.manualIncludes).toContain('docs/v1.md');
    expect(res.body.corpus.skippedDocs).toContainEqual({ ref: `context/${SOURCE}/archived.md`, reason: 'archived directory' });
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

  // The repo's baseline commit — the anchor the repo-level guard-report read
  // resolves through the guard store, never "newest".
  const BASELINE_COMMIT = 'basesha1111';

  // A guard store whose generate report is `status`. `open-conflicts` = a generate
  // that stalled BLOCKED before authoring scenarios (the unblock trigger); anything
  // else = a healthy report that must NOT re-trigger. `null` = no report at all.
  const stubGuardReport = (status: GuardGenerateReport['status'] | null): void => {
    setGuardStore({
        readGuardBaselineCommit: async () => BASELINE_COMMIT,
      readGuardResult: async () =>
        status === null ? null : ({ status } as unknown as GuardGenerateReport),
    } as unknown as GuardStore);
  };

  beforeEach(async () => {
    // The default for the cases that do not pin a report of their own.
    installWorkTreeGuardStore();
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
    resetContextStore();
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
    // Commit-aware guard stub: the BASELINE row is the blocked open-conflicts
    // report; any commit-less ("newest by createdAt") read sees a PR regen's ok
    // report instead — which would wrongly skip the unblock generate forever.
    setGuardStore({
        readGuardBaselineCommit: async () => BASELINE_COMMIT,
      readGuardResult: async (_repoKey: string, commitSha?: string) =>
        ({
          status: commitSha === BASELINE_COMMIT ? 'open-conflicts' : 'ok',
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
        readGuardBaselineCommit: async () => BASELINE_COMMIT,
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
    stubGuardReport('open-conflicts');
    await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send(VERDICT)
      .expect(200);
    expect(tasks).toEqual([]);
  });

  // The Rescan dot: an include/exclude the stored corpus has not absorbed pends
  // (a Scan would materialize it); a verdict derives live and never does. Both
  // the corpus and the decisions it is read against are the WORKSPACE's now, so
  // the decisions are written through the workspace routes.
  it('GET /spec/staleness reports decisionsPending for an unabsorbed exclude, not for a verdict', async () => {
    setContextStore(memoryContextStore());
    await seedWorkspaceCorpus(memSpec, { conflict: true });
    const staleness = () =>
      request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);

    const before = await staleness();
    expect(before.body.decisionsPending).toBe(false);
    await request(app).post('/api/context/conflict-resolution').send(WS_VERDICT).expect(200);
    const afterVerdict = await staleness();
    expect(afterVerdict.body.decisionsPending).toBe(false);
    await request(app)
      .post('/api/context/excludes')
      .send({ ref: 'context/repo-src/docs/v2.md' })
      .expect(200);
    const afterExclude = await staleness();
    expect(afterExclude.body.decisionsPending).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Doc-content staleness (docsChanged). There is no tree to stat: what can move
// under the stored corpus is the workspace's CONTEXT — a source synced, a link
// made or dropped, a source removed — and the workspace stamps every one of
// those. A stamp later than the corpus lights the Rescan dot.
// ---------------------------------------------------------------------------

describe('spec docs-content staleness', () => {
  let app: Express;
  let fixture: TestFixture;

  const DOC = `context/${SOURCE}/spec.md`;

  /** A one-doc workspace corpus curated at `generatedAt`. */
  const seed = (generatedAt: string): Promise<void> =>
    saveWorkspaceSpec({ workspaceOrgId: TEST_ORG }, 'corpus', {
      version: 3,
      generatedAt,
      docs: [{ ref: DOC, kind: 'spec', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['core/persistence'], sourceId: SOURCE }],
      areas: [{ id: 'core/persistence', product: 'core', concern: 'persistence', docRefs: [DOC], overlaps: [] }],
      relations: [],
      skippedDocs: [],
    });

  const staleness = () =>
    request(app).get(`/api/repos/${fixture.project.slug}/spec/staleness`).expect(200);

  /** The workspace's clock, so "the context moved after the corpus" is exact. */
  let now: string;

  beforeEach(async () => {
    installMemorySpecStore();
    now = '2026-06-01T00:00:00.000Z';
    setContextStore(memoryContextStore(() => now));
    fixture = await setupTestFixture();
    app = createTestApp();
    // The link the repository reads the source through — and the first thing to
    // move the workspace's stamp.
    await setContextBindings(TEST_ORG, fixture.repoPath, [SOURCE]);
  });
  afterEach(async () => {
    setBackgroundTaskRunner(null);
    resetSpecStore();
    resetContextStore();
    await teardownTestFixture(fixture.project.slug);
  });

  it('docsChanged is false for a corpus curated after the last context change, true after the next one', async () => {
    // Curated AFTER the link that moved the stamp.
    await seed('2026-06-02T00:00:00.000Z');
    const before = await staleness();
    expect(before.body.docsChanged).toBe(false);
    expect(before.body.decisionsPending).toBe(false);

    // The workspace's context moves again — the last scan never saw this.
    now = '2026-06-03T00:00:00.000Z';
    await setContextBindings(TEST_ORG, fixture.repoPath, [SOURCE, 'another-source']);

    const after = await staleness();
    expect(after.body.docsChanged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Section-scoped conflict verdicts — POST/DELETE /spec/conflict-resolution
// ---------------------------------------------------------------------------

describe('conflict-resolution routes', () => {
  let app: Express;
  let fixture: TestFixture;

  const verdict = {
    docA: 'docs/v1.md',
    anchorA: 'Cancellation',
    docB: 'docs/v2.md',
    anchorB: 'Cancellation policy',
    verdict: 'a' as const,
  };

  beforeEach(async () => {
    installMemorySpecStore();
    // A verdict asks whether it cleared the last conflict blocking a generate,
    // which reads the guard report.
    installWorkTreeGuardStore();
    fixture = await setupTestFixture();
    gitInit(fixture.repoPath);
    vi.mocked(curateInProcess).mockClear();
    app = createTestApp();
  });
  afterEach(async () => {
    setBackgroundTaskRunner(null);
    resetSpecStore();
    resetGuardStore();
    await teardownTestFixture(fixture.project.slug);
  });

  // Only the ACK is assertable: the verdict is written at repo scope and every
  // read beside it (the corpus payload, the staleness probe) is workspace-scoped,
  // so nothing here can read it back. See the note in the corpus-routes describe.
  it('POST records a verdict without re-curating, and acks the persisted verdicts', async () => {
    const res = await request(app)
      .post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send(verdict)
      .expect(200);
    expect(res.body.conflictResolutions).toHaveLength(1);
    expect(res.body.conflictResolutions[0]).toMatchObject({ docA: 'docs/v1.md', verdict: 'a' });
    expect(res.body.conflictResolutions[0].resolvedAt).toBeTruthy();
    expect(res.body.corpus).toBeUndefined();
    expect(vi.mocked(curateInProcess)).not.toHaveBeenCalled();
  });

  it('DELETE removes the verdict by dispute identity', async () => {
    await request(app).post(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`).send(verdict).expect(200);
    const del = await request(app)
      .delete(`/api/repos/${fixture.project.slug}/spec/conflict-resolution`)
      .send({ docA: 'docs/v1.md', anchorA: 'Cancellation', docB: 'docs/v2.md', anchorB: 'Cancellation policy' })
      .expect(200);
    expect(del.body.conflictResolutions).toEqual([]);
  });

  it('400s on a missing/equal doc pair or a bad verdict', async () => {
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
