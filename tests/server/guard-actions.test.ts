import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { type Express } from 'express';

/**
 * Guard ACTION routes (OSS) — the write surface that triggers `guard generate` /
 * `guard run` from the dashboard. Temp-repo fixture + supertest over the real app.
 *
 * The estimate route runs the REAL estimateGuard (deterministic, offline —
 * TRUECOURSE_NO_PRICE_FETCH is set by tests/setup.ts), so its shape is asserted
 * against a direct call: proof the dashboard shows the SAME numbers as the CLI. The
 * two engine drivers are mocked (never a real LLM call, no sandbox build), so the
 * trigger tests assert only the route contract: it starts the job, emits the
 * completion lifecycle event, rejects a concurrent duplicate (409), and returns the
 * clean cancel on a declined estimate.
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
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import { PgGuardStore } from '../../ee/packages/data-store/src/index';
import { createApp } from '../../apps/dashboard/server/src/app';
import { emitSpecComplete } from '../../apps/dashboard/server/src/socket/handlers';
import {
  estimateGuard,
  guardGenerateInProcess,
  guardRunInProcess,
  EstimateDeclined,
} from '@truecourse/core/commands/guard-in-process';
import { setGuardStore, resetGuardStore } from '@truecourse/core/lib/guard-store';
import { setupTestFixture, teardownTestFixture, type TestFixture } from '../helpers/test-db';

const DOC = 'docs/cli.md';
const DOC_CONTENT = ['## version', '`app --version` prints the version and exits 0.', '', '## background', 'Design history — nothing observable.'].join('\n');

describe('Guard action routes', () => {
  let app: Express;
  let fixture: TestFixture;
  let root: string;

  const write = (rel: string, content: string) => {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };
  const writeJson = (rel: string, obj: unknown) => write(rel, JSON.stringify(obj, null, 2));
  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;

  // A corpus with one doc + the doc on disk, and NO scenarios manifest → every
  // section is "changed", so the estimate carries stages (a non-trivial estimate).
  function seedCorpus() {
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
    fixture = await setupTestFixture();
    root = fixture.repoPath;
    vi.mocked(guardGenerateInProcess).mockReset();
    vi.mocked(guardRunInProcess).mockReset();
    vi.mocked(emitSpecComplete).mockClear();
    app = createApp({ serveStatic: false });
  });
  afterEach(async () => {
    await teardownTestFixture(fixture.project.slug);
  });

  // --- Estimate: the CLI-identical shape ------------------------------------

  it('GET /guard/estimate returns the same estimateGuard payload the CLI renders', async () => {
    seedCorpus();
    const res = await request(app).get(url('estimate')).expect(200);
    const direct = JSON.parse(JSON.stringify(await estimateGuard(root)));
    // Byte-identical to a direct estimateGuard call — no re-derivation.
    expect(res.body.estimate).toEqual(direct);
    // And it is the staged pipeline shape (what the modal + CLI prompt render).
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

  it('POST /guard/generate starts the job, honors confirmed, and emits guard-generate', async () => {
    vi.mocked(guardGenerateInProcess).mockResolvedValue({
      guard: { status: 'ok', noChanges: false, written: [{}, {}], birthFindings: [{}] },
    } as never);

    const res = await request(app).post(url('generate')).send({ confirmed: true }).expect(200);
    expect(res.body).toEqual({ status: 'ok', noChanges: false, written: 2, birthFindings: 1 });

    expect(vi.mocked(guardGenerateInProcess)).toHaveBeenCalledTimes(1);
    // The confirmed flag flows into the driver's estimate gate.
    const [, opts] = vi.mocked(guardGenerateInProcess).mock.calls[0] as [string, { onLlmEstimate: () => Promise<boolean> }];
    await expect(opts.onLlmEstimate()).resolves.toBe(true);
    expect(vi.mocked(emitSpecComplete)).toHaveBeenCalledWith(fixture.project.slug, 'guard-generate');
  });

  it('POST /guard/generate returns { cancelled } when the estimate gate declines', async () => {
    vi.mocked(guardGenerateInProcess).mockRejectedValue(new EstimateDeclined('guard'));
    const res = await request(app).post(url('generate')).send({ confirmed: false }).expect(200);
    expect(res.body).toEqual({ cancelled: true });
    // A declined estimate flowing through: onLlmEstimate resolves false.
    const [, opts] = vi.mocked(guardGenerateInProcess).mock.calls[0] as [string, { onLlmEstimate: () => Promise<boolean> }];
    await expect(opts.onLlmEstimate()).resolves.toBe(false);
  });

  it('POST /guard/generate rejects a concurrent duplicate with 409', async () => {
    let release!: () => void;
    vi.mocked(guardGenerateInProcess).mockImplementation(
      () => new Promise((r) => { release = () => r({ guard: { status: 'ok', noChanges: true, written: [], birthFindings: [] } } as never); }),
    );

    // `.then(...)` fires the request now (supertest is otherwise lazy); await it at
    // the end. Give the first handler time to acquire the lock before racing it.
    const firstDone = request(app).post(url('generate')).send({ confirmed: true }).then((r) => r);
    await new Promise((r) => setTimeout(r, 150));

    await request(app).post(url('generate')).send({ confirmed: true }).expect(409);
    // A run trigger is rejected too — generate + run share the one-job-per-repo lock.
    await request(app).post(url('run')).expect(409);

    release();
    const firstRes = await firstDone;
    expect(firstRes.status).toBe(200);
    // Lock released → a fresh trigger is accepted again.
    vi.mocked(guardGenerateInProcess).mockResolvedValue({ guard: { status: 'ok', noChanges: true, written: [], birthFindings: [] } } as never);
    await request(app).post(url('generate')).send({ confirmed: true }).expect(200);
  });

  // --- Run trigger ----------------------------------------------------------

  it('POST /guard/run starts the run and emits guard-run on ok', async () => {
    const summary = { total: 3, pass: 2, fail: 1, stale: 0, orphaned: 0, error: 0 };
    vi.mocked(guardRunInProcess).mockResolvedValue({ status: 'ok', latest: { summary } } as never);

    const res = await request(app).post(url('run')).expect(200);
    expect(res.body).toEqual({ status: 'ok', summary });
    expect(vi.mocked(guardRunInProcess)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(emitSpecComplete)).toHaveBeenCalledWith(fixture.project.slug, 'guard-run');
  });

  it('POST /guard/run surfaces a non-ok status with a message (no recipe)', async () => {
    vi.mocked(guardRunInProcess).mockResolvedValue({ status: 'no-recipe' } as never);
    const res = await request(app).post(url('run')).expect(200);
    expect(res.body.status).toBe('no-recipe');
    expect(res.body.message).toMatch(/recipe/i);
  });
});

// --- Dismiss / undismiss: PR overlay (hosted store) -------------------------
//
// `?pr=N` threads the PR overlay through to the write and the response is the MERGED
// effective view; no `pr` behaves exactly as the OSS file-store path. Needs the
// enterprise store installed (a PR scope is enterprise-only), so this block swaps in
// a PgGuardStore rather than the OSS fixture's file store.
describe('Guard dismiss/undismiss routes — PR overlay (hosted)', () => {
  let app: Express;
  let fixture: TestFixture;
  let client: PGlite;

  const url = (suffix: string) => `/api/repos/${fixture.project.slug}/guard/${suffix}`;
  const repoClaim = { doc: 'docs/cli.md', anchor: 'a', title: 'repo claim' };
  const prClaim = { doc: 'docs/cli.md', anchor: 'b', title: 'pr claim' };
  const titles = (claims: Array<{ title: string }>) => claims.map((c) => c.title).sort();

  beforeEach(async () => {
    fixture = await setupTestFixture();
    app = createApp({ serveStatic: false });
    client = new PGlite();
    const db = drizzle(client, { schema }) as unknown as EeDb;
    await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    setGuardStore(new PgGuardStore(db));
  });
  afterEach(async () => {
    resetGuardStore();
    await client.close();
    await teardownTestFixture(fixture.project.slug);
  });

  it('POST /guard/dismiss?pr=N writes the overlay and returns the merged effective view', async () => {
    // A repo-scoped dismissal already exists (no pr).
    await request(app).post(url('dismiss')).send(repoClaim).expect(200);

    // Dismiss a different claim from the PR view.
    const res = await request(app).post(url('dismiss?pr=7')).send(prClaim).expect(200);
    // The response is the MERGED view: repo-level claim + the newly dismissed PR claim.
    expect(titles(res.body.dismissedClaims)).toEqual(['pr claim', 'repo claim']);
  });

  it('POST /guard/dismiss?pr=N does not touch the repo row', async () => {
    await request(app).post(url('dismiss?pr=7')).send(prClaim).expect(200);
    // The repo scope (no pr) never saw the PR dismissal.
    const repo = await request(app).get(url('decisions')).expect(200);
    expect(repo.body.dismissedClaims).toEqual([]);
  });

  it('POST /guard/dismiss without pr behaves as before (writes + returns the repo row)', async () => {
    const res = await request(app).post(url('dismiss')).send(repoClaim).expect(200);
    expect(titles(res.body.dismissedClaims)).toEqual(['repo claim']);
    // The repo decisions read back the same single claim.
    const repo = await request(app).get(url('decisions')).expect(200);
    expect(titles(repo.body.dismissedClaims)).toEqual(['repo claim']);
  });

  it('POST /guard/undismiss?pr=N removes only from the overlay (repo dismissal survives in the merged view)', async () => {
    await request(app).post(url('dismiss')).send(repoClaim).expect(200); // repo scope
    await request(app).post(url('dismiss?pr=7')).send(prClaim).expect(200); // overlay
    const res = await request(app).post(url('undismiss?pr=7')).send(prClaim).expect(200);
    // The PR claim is gone from the overlay; the repo claim still shows (merged view).
    expect(titles(res.body.dismissedClaims)).toEqual(['repo claim']);
  });

  // A present-but-invalid `?pr=` must 400, never silently fall back to the repo
  // scope: the repo row is the committable decisions file, and a PR-scoped judgment
  // landing there would promote it for everyone (mirrors the spec routes' strict parse).
  it.each(['abc', '0', '-1', '7.5'])(
    'POST /guard/dismiss?pr=%s is a 400 and writes nothing',
    async (bad) => {
      const res = await request(app).post(url(`dismiss?pr=${bad}`)).send(prClaim).expect(400);
      expect(res.body.error).toMatch(/positive integer/);
      const repo = await request(app).get(url('decisions')).expect(200);
      expect(repo.body.dismissedClaims).toEqual([]);
    },
  );

  it('POST /guard/undismiss?pr=abc is a 400 and removes nothing', async () => {
    await request(app).post(url('dismiss')).send(repoClaim).expect(200); // repo scope
    await request(app).post(url('undismiss?pr=abc')).send(repoClaim).expect(400);
    const repo = await request(app).get(url('decisions')).expect(200);
    expect(titles(repo.body.dismissedClaims)).toEqual(['repo claim']);
  });
});
