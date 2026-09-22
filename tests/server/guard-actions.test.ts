import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';

/**
 * Guard ACTION routes — the write surface that triggers `guard generate` /
 * `guard run` from the dashboard. Temp-repo fixture + supertest over the real app.
 *
 * The estimate route runs the REAL estimateGuard (deterministic, offline —
 * tests/setup.ts installs no model prices), so its shape is asserted
 * against a direct call: proof the route answers exactly what `estimateGuard`
 * returns. The two engine drivers are mocked (never a real LLM call, no sandbox build), so the
 * trigger tests assert only the route contract: generate ENQUEUES (202, 409 while
 * the repo is working), run starts in the request, emits the completion lifecycle
 * event and rejects a concurrent duplicate (409).
 */

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  return {
    ...actual,
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
  };
});

vi.mock('@truecourse/core/commands/guard-in-process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@truecourse/core/commands/guard-in-process')>();
  return {
    ...actual, // keep estimateGuard, GUARD_*_STEPS, and EstimateDeclined real
    guardGenerateInProcess: vi.fn(),
    guardRunInProcess: vi.fn(),
  };
});

import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import { PgGuardStore } from '../../packages/data-store/src/index';
import { createTestApp, stubJobs, TEST_ORG, TEST_USER, type StubJobs } from '../helpers/test-app';
import { emitSpecComplete } from '../../apps/dashboard/server/src/socket/handlers';
import {
  estimateGuard,
  guardGenerateInProcess,
  guardRunInProcess,
} from '@truecourse/core/commands/guard-in-process';
import { setGuardStore, resetGuardStore, writeGuardResult } from '@truecourse/core/lib/guard-store';
import { setGuardGenerateEnqueue } from '@truecourse/core/lib/guard-generate-enqueue';
import type { GuardGenerateReport } from '@truecourse/shared';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-fixture';
import { installWorkTreeGuardStore } from '../helpers/work-tree-guard-store';
import { installMemoryGuardOverlays, resetGuardOverlayStore } from '../helpers/memory-guard-overlays';
import { installMemorySpecStore, resetSpecStore } from '../helpers/memory-spec-store';



const DOC = 'docs/cli.md';
const DOC_CONTENT = ['## version', '`app --version` prints the version and exits 0.', '', '## background', 'Design history — nothing observable.'].join('\n');

describe('Guard action routes', () => {
  let app: Express;
  let fixture: TestFixture;
  let root: string;
  let jobs: StubJobs;

  const write = (rel: string, content: string) => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };
  const writeJson = (rel: string, obj: unknown) => write(rel, JSON.stringify(obj, null, 2));
  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;

  // A corpus with one doc + the doc on disk, and NO scenarios manifest → every
  // section is "changed", so the estimate carries stages (a non-trivial estimate).
  function seedCorpus(): void {
    writeJson('.truecourse/specs/corpus.json', {
      version: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      docs: [{ ref: DOC, kind: 'prd', lastTouched: '2026-01-01T00:00:00Z', areaTags: ['cli'] }],
      areas: [{ id: 'cli', product: 'cli', concern: 'cli', docRefs: [DOC], overlaps: [] }],
      relations: [],
    });
    write(DOC, DOC_CONTENT);
  }

  beforeEach(async () => {
    installWorkTreeGuardStore();
    installMemoryGuardOverlays();
    installMemorySpecStore();
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    vi.mocked(guardGenerateInProcess).mockReset();
    vi.mocked(guardRunInProcess).mockReset();
    vi.mocked(emitSpecComplete).mockClear();
    jobs = stubJobs();
    app = createTestApp({ jobs: jobs.mount });
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
    resetGuardStore();
    resetGuardOverlayStore();
    resetSpecStore();
  });

  // --- Estimate: the engine-identical shape ---------------------------------

  it('GET /guard/estimate returns the same estimateGuard payload the CLI renders', async () => {
    seedCorpus();
    const res = await request(app).get(url('estimate')).expect(200);
    const direct = JSON.parse(JSON.stringify(await estimateGuard(root)));
    // Byte-identical to a direct estimateGuard call — no re-derivation.
    expect(res.body.estimate).toEqual(direct);
    // And it is the staged pipeline shape (what the confirm modal renders).
    expect(Array.isArray(res.body.estimate.stages)).toBe(true);
    expect(res.body.estimate.stages.length).toBeGreaterThan(0);
    expect(res.body.estimate.stages[0]).toMatchObject({ stage: expect.any(String), model: expect.any(String), calls: expect.any(Number) });
    expect(res.body.estimate.subjectLabel).toMatch(/section/);
  });

  it('GET /guard/estimate has no stages when nothing changed (client skips the modal)', async () => {
    // A recipe already present (no discovery stage) + no corpus docs (no changed
    // sections to extract/author) → every stage has zero calls → no stages.
    writeJson('.truecourse/scenarios/recipe.json', { build: 'echo build', entry: ['node', 'x.js'] });
    const res = await request(app).get(url('estimate')).expect(200);
    expect(res.body.estimate.stages ?? []).toEqual([]);
  });

  // --- Generate trigger -----------------------------------------------------

  it('POST /guard/generate enqueues the job and answers 202', async () => {
    const res = await request(app).post(url('generate')).expect(202);
    expect(res.body).toEqual({ jobId: 'job_test' });
    expect(jobs.guardGenerates).toEqual([
      { repoId: fixture.project.slug, repoFullName: root, workspaceOrgId: TEST_ORG, source: 'manual', requestedBy: TEST_USER },
    ]);
    // The queue owns the work: the route neither runs the engine nor announces a
    // completion of its own.
    expect(vi.mocked(guardGenerateInProcess)).not.toHaveBeenCalled();
    expect(vi.mocked(emitSpecComplete)).not.toHaveBeenCalled();
  });

  it('POST /guard/generate answers 409 while the repository is already working', async () => {
    jobs.answer = { status: 'busy' };
    const res = await request(app).post(url('generate')).expect(409);
    expect(res.body.error).toMatch(/already running/i);
  });

  // --- Run trigger ----------------------------------------------------------

  it('POST /guard/run enqueues the job and answers 202', async () => {
    const res = await request(app).post(url('run')).expect(202);
    expect(res.body).toEqual({ jobId: 'job_test' });
    expect(jobs.guardRuns).toEqual([
      { repoId: fixture.project.slug, repoFullName: root, workspaceOrgId: TEST_ORG, source: 'manual', requestedBy: TEST_USER },
    ]);
    // The queue owns the work: the route neither runs the runner nor announces a
    // completion of its own.
    expect(vi.mocked(guardRunInProcess)).not.toHaveBeenCalled();
    expect(vi.mocked(emitSpecComplete)).not.toHaveBeenCalled();
  });

  it('POST /guard/run answers 409 while the repository is already working', async () => {
    jobs.answer = { status: 'busy' };
    const res = await request(app).post(url('run')).expect(409);
    expect(res.body.error).toMatch(/already running/i);
  });

  // --- Flow dismissal — the manual dismissal unit ----------------------------
  //
  // Instant file writes like the claim pair: no job, no lock, no engine run.

  const flowBody = { flowId: 'task-lifecycle', title: 'Task lifecycle' };

  it('POST /guard/flows/dismiss records the flow and returns the updated decisions', async () => {
    const res = await request(app).post(url('flows/dismiss')).send({ ...flowBody, note: 'not a user path' }).expect(200);
    expect(res.body.dismissedFlows).toEqual([
      expect.objectContaining({ flowId: 'task-lifecycle', title: 'Task lifecycle', note: 'not a user path' }),
    ]);
    // It reads back from the stored decisions, not just the response.
    const read = await request(app).get(url('decisions')).expect(200);
    expect(read.body.dismissedFlows.map((f: { flowId: string }) => f.flowId)).toEqual(['task-lifecycle']);
    // The claim tier is untouched.
    expect(read.body.dismissedClaims).toEqual([]);
  });

  it('POST /guard/flows/dismiss is idempotent on flowId', async () => {
    await request(app).post(url('flows/dismiss')).send(flowBody).expect(200);
    const res = await request(app).post(url('flows/dismiss')).send({ ...flowBody, note: 'second' }).expect(200);
    expect(res.body.dismissedFlows).toHaveLength(1);
    expect(res.body.dismissedFlows[0].note).toBe('second');
  });

  it('POST /guard/flows/undismiss removes it; an unknown flow is a no-op, not an error', async () => {
    await request(app).post(url('flows/dismiss')).send(flowBody).expect(200);
    const noop = await request(app).post(url('flows/undismiss')).send({ flowId: 'never-dismissed' }).expect(200);
    expect(noop.body.dismissedFlows.map((f: { flowId: string }) => f.flowId)).toEqual(['task-lifecycle']);
    const res = await request(app).post(url('flows/undismiss')).send(flowBody).expect(200);
    expect(res.body.dismissedFlows).toEqual([]);
  });

  it('POST /guard/flows/dismiss without a flowId or title is a 400', async () => {
    await request(app).post(url('flows/dismiss')).send({ title: 'Task lifecycle' }).expect(400);
    await request(app).post(url('flows/dismiss')).send({ flowId: 'task-lifecycle' }).expect(400);
    await request(app).post(url('flows/undismiss')).send({}).expect(400);
    const read = await request(app).get(url('decisions')).expect(200);
    expect(read.body.dismissedFlows).toEqual([]);
  });

  // The dismissal is a decision, never a trigger: neither engine driver may run.
  it('POST /guard/flows/dismiss never starts a guard job', async () => {
    await request(app).post(url('flows/dismiss')).send(flowBody).expect(200);
    expect(vi.mocked(guardGenerateInProcess)).not.toHaveBeenCalled();
    expect(vi.mocked(guardRunInProcess)).not.toHaveBeenCalled();
  });
});

// --- Dismiss / undismiss over the hosted store ------------------------------
//
// The same routes the dashboard calls, with the Postgres store installed: a
// dismissal lands on the repository's one decisions row and reads back.
describe('Guard dismiss/undismiss routes (hosted store)', () => {
  let app: Express;
  let fixture: TestFixture;
  let client: PGlite;

  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;
  const claimA = { doc: 'docs/cli.md', anchor: 'a', title: 'claim A' };
  const claimB = { doc: 'docs/cli.md', anchor: 'b', title: 'claim B' };
  const titles = (claims: Array<{ title: string }>) => claims.map((c) => c.title).sort();

  beforeEach(async () => {
    fixture = await setupTestFixture();
    app = createTestApp();
    client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as Db;
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    setGuardStore(new PgGuardStore(db));
  });
  afterEach(async () => {
    resetGuardStore();
    await client.close();
    await teardownTestFixture(fixture.project.slug);
  });

  it('POST /guard/dismiss writes the row and GET /guard/decisions reads it back', async () => {
    const res = await request(app).post(url('dismiss')).send(claimA).expect(200);
    expect(titles(res.body.dismissedClaims)).toEqual(['claim A']);
    const read = await request(app).get(url('decisions')).expect(200);
    expect(titles(read.body.dismissedClaims)).toEqual(['claim A']);
  });

  it('a second dismissal joins the same row', async () => {
    await request(app).post(url('dismiss')).send(claimA).expect(200);
    const res = await request(app).post(url('dismiss')).send(claimB).expect(200);
    expect(titles(res.body.dismissedClaims)).toEqual(['claim A', 'claim B']);
  });

  it('POST /guard/undismiss removes only the named claim', async () => {
    await request(app).post(url('dismiss')).send(claimA).expect(200);
    await request(app).post(url('dismiss')).send(claimB).expect(200);
    const res = await request(app).post(url('undismiss')).send(claimA).expect(200);
    expect(titles(res.body.dismissedClaims)).toEqual(['claim B']);
    const read = await request(app).get(url('decisions')).expect(200);
    expect(titles(read.body.dismissedClaims)).toEqual(['claim B']);
  });

  it('POST /guard/flows/dismiss writes the flow tier of the same row', async () => {
    const flow = { flowId: 'task-lifecycle', title: 'Task lifecycle' };
    await request(app).post(url('flows/dismiss')).send(flow).expect(200);
    const read = await request(app).get(url('decisions')).expect(200);
    expect(read.body.dismissedFlows.map((f: { flowId: string }) => f.flowId)).toEqual(['task-lifecycle']);
    expect(read.body.dismissedClaims).toEqual([]);
  });
});

// --- Dismiss → hosted auto-regenerate (repo scope) -------------------------
//
// A repo-scope dismissal that suppresses the LAST active finding re-generates the
// scenario corpus honoring the dismissal — the hosted analog of resolving the last
// spec conflict. The write rides the `setGuardGenerateEnqueue` seam the server
// installs at boot; a test that leaves it unset gets the dismissal alone. The
// findings live in the guard result store, so the tree-backed fixture seeds one.
describe('Guard dismiss → hosted auto-regenerate (repo scope)', () => {
  let app: Express;
  let fixture: TestFixture;
  let root: string;
  let enqueue: ReturnType<typeof vi.fn>;

  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;

  // Two birth findings, each carrying its dismissible claim; dismiss keys on the
  // claim text (the same `dismissedClaimKey` the coverage view derives "active" from).
  const findingA = { doc: 'docs/cli.md', anchor: 'a', title: 'A scenario', claim: 'claim A' };
  const findingB = { doc: 'docs/cli.md', anchor: 'b', title: 'B scenario', claim: 'claim B' };

  const report = (findings: Array<{ doc: string; anchor: string; title: string; claim?: string }>): GuardGenerateReport => ({
    generatedAt: '2026-01-01T00:00:00Z',
    status: 'ok',
    sectionsTotal: 2,
    sectionsChanged: 2,
    skippedUnchanged: 0,
    noChanges: false,
    written: [],
    coverageGaps: [],
    birthFindings: findings.map((f) => ({
      doc: f.doc,
      anchor: f.anchor,
      title: f.title,
      step: 1,
      expected: 'x',
      actual: 'y',
      ...(f.claim ? { claim: f.claim } : {}),
    })),
    errors: [],
    extractionFailures: [],
    orphaned: [],
  });

  // Dismiss by the finding's CLAIM (dismiss's `title` is the extracted claim text).
  const dismiss = (f: { doc: string; anchor: string; claim: string }) =>
    request(app).post(url('dismiss')).send({ doc: f.doc, anchor: f.anchor, title: f.claim });

  beforeEach(async () => {
    installWorkTreeGuardStore();
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    app = createTestApp();
    enqueue = vi.fn().mockResolvedValue(undefined);
    setGuardGenerateEnqueue(enqueue);
  });
  afterEach(async () => {
    setGuardGenerateEnqueue(null);
    await teardownTestFixture(fixture.project.slug);
    resetGuardStore();
  });

  it('batches while findings remain active, then re-generates on the LAST dismissal', async () => {
    await writeGuardResult({ repoKey: root, commitSha: 'head' }, report([findingA, findingB]));

    // One of two dismissed → one finding still active → NO regenerate.
    await dismiss(findingA).expect(200);
    expect(enqueue).not.toHaveBeenCalled();

    // The last active finding dismissed → exactly one hosted regenerate, keyed by repo.
    await dismiss(findingB).expect(200);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledWith(root);
  });

  it('does not regenerate when a finding with no dismissible claim stays active', async () => {
    // findingB has no `claim` → it can never be dismissed → always active.
    await writeGuardResult({ repoKey: root, commitSha: 'head' }, report([findingA, { ...findingB, claim: undefined }]));
    await dismiss(findingA).expect(200);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not regenerate when the report has no findings at all', async () => {
    await writeGuardResult({ repoKey: root, commitSha: 'head' }, report([]));
    await request(app).post(url('dismiss')).send({ doc: 'docs/cli.md', anchor: 'z', title: 'stray' }).expect(200);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('swallows a seam failure — the dismissal still succeeds', async () => {
    enqueue.mockRejectedValue(new Error('queue down'));
    await writeGuardResult({ repoKey: root, commitSha: 'head' }, report([findingA]));
    // The only finding is dismissed → the seam fires and throws, but the write is 200.
    const res = await dismiss(findingA).expect(200);
    expect(res.body.dismissedClaims.map((c: { title: string }) => c.title)).toEqual(['claim A']);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('never enqueues when the seam is unset (OSS)', async () => {
    setGuardGenerateEnqueue(null);
    await writeGuardResult({ repoKey: root, commitSha: 'head' }, report([findingA]));
    await dismiss(findingA).expect(200); // the write alone, no throw
    expect(enqueue).not.toHaveBeenCalled();
  });

  // HOSTED (Pg store): the auto-regen decision must read the REPO's report — the
  // baseline commit's row — never the store's newest row by createdAt, which a
  // report stored at another commit would shadow (masking the active findings).
  describe('hosted store — baseline-anchored report read', () => {
    let client: PGlite;

    beforeEach(async () => {
      client = new PGlite();
      const db = drizzle(client, { schema }) as unknown as Db;
      await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
      setGuardStore(new PgGuardStore(db));
    });
    afterEach(async () => {
      resetGuardStore();
      await client.close();
    });

    it("a newer report in a pull request's scope never masks the repo's findings — the last dismissal still regenerates", async () => {
      // The default branch's generate is the repo's anchor.
      await writeGuardResult({ repoKey: root, commitSha: 'basesha1111' }, report([findingA]));
      // A findings-free report stored under a pull request's scope — strictly
      // newer createdAt, so a scope-blind "newest" read would see zero findings and skip.
      await new Promise((r) => setTimeout(r, 5));
      await writeGuardResult({ repoKey: root, commitSha: 'othersha9999', scope: 'pr/9' }, report([]));

      await dismiss(findingA).expect(200);
      expect(enqueue).toHaveBeenCalledTimes(1);
      expect(enqueue).toHaveBeenCalledWith(root);
    });
  });
});
