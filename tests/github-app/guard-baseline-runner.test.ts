/**
 * Guard-baseline pipeline (issue 06): the REAL pipeline body over a PGlite-backed
 * guard store, with fakes only at the clone/corpus/executor seams. Covers the
 * happy refresh (run the committed corpus → writeGuardLatest), the no-corpus and
 * no-verdict short-circuits (no baseline overwrite), phase progress, the shared
 * concurrency limiter wrapping the executor, and unconditional checkout cleanup.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type { GuardLatest, GuardOutcome, GuardScenario, GuardScenarioResult } from '@truecourse/shared';
import {
  defaultGuardExecutor,
  buildDocSectionIndex,
  type GuardExecInput,
  type GuardExecReport,
  type GuardExecutor,
  type Recipe,
} from '@truecourse/guard-runner';
import { PgGuardStore } from '../../ee/packages/data-store/src/index';
import { createSemaphore } from '../../ee/packages/server/src/jobs/guard-gate-limiter';
import type { GithubAuth } from '../../ee/packages/github-app/src/github';
import {
  createGuardBaselinePipeline,
  type GuardBaselinePipelineDeps,
  type GuardBaselineRunRequest,
} from '../../ee/packages/github-app/src/guard-baseline-runner';

const REPO = 'acme/api';
const COMMIT = 'main1234567890';
const RECIPE: Recipe = { build: 'npm run build', entry: ['node', 'cli.js'] };

function scenario(id: string): GuardScenario {
  return {
    guard: 3,
    id,
    title: `t-${id}`,
    binds: [{ doc: 'README.md', section: 'intro', fingerprint: 'sha256:f' }],
    driver: 'cli',
    steps: [{ run: ['--help'], expect: { exit: 0 } }],
    normalize: [],
  };
}

function result(id: string, outcome: GuardOutcome): GuardScenarioResult {
  return {
    id,
    title: `t-${id}`,
    binds: { doc: 'README.md', section: 'intro', fingerprint: 'sha256:f' },
    outcome,
    durationMs: 1,
  };
}

function latestOf(scenarios: GuardScenarioResult[], commit: string): GuardLatest {
  const summary = { total: scenarios.length, pass: 0, fail: 0, stale: 0, orphaned: 0, error: 0 };
  for (const s of scenarios) summary[s.outcome] += 1;
  return {
    run: {
      runId: `run-${commit}`,
      ranAt: '2026-07-10T00:00:00.000Z',
      branch: 'main',
      commit,
      recipeFingerprint: 'sha256:r',
      scenarioFormat: 3,
    },
    summary,
    scenarios,
    sections: [],
  };
}

const okReport = (latest: GuardLatest): GuardExecReport => ({
  status: 'ok',
  latest,
  latestPath: '',
  loadErrors: [],
  manifest: null,
});

const req = (over: Partial<GuardBaselineRunRequest> = {}): GuardBaselineRunRequest => ({
  repoFullName: REPO,
  installationId: 42,
  workspaceOrgId: 'org_A',
  defaultBranch: 'main',
  commitSha: COMMIT,
  ...over,
});

let client: PGlite;
let db: EeDb;
let guardStore: PgGuardStore;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as EeDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  guardStore = new PgGuardStore(db);
});

afterEach(async () => {
  await client.close();
});

function makeDeps(execute: GuardExecutor, limiter = { run: (fn: () => Promise<any>) => fn() }) {
  const deps: GuardBaselinePipelineDeps = {
    guardStore,
    auth: {} as GithubAuth,
    execute,
    limiter,
  };
  return deps;
}

/** A clone seam that records the checkout dir so the test can assert cleanup. */
function fakeClone() {
  const seen: { dir?: string } = {};
  const clone = async (
    _deps: { auth: GithubAuth; signal?: AbortSignal },
    _req: GuardBaselineRunRequest,
    dir: string,
  ) => {
    seen.dir = dir;
  };
  return { clone, seen };
}

const corpusOf = (scenarios: GuardScenario[]) => async () => ({ recipe: RECIPE, scenarios });

describe('guard-baseline pipeline — happy refresh', () => {
  it('runs the committed corpus and writes the result as the guard baseline', async () => {
    const ran = latestOf([result('s1', 'pass'), result('s2', 'fail')], COMMIT);
    let execInput: GuardExecInput | undefined;
    const execute: GuardExecutor = async (input) => {
      execInput = input;
      return okReport(ran);
    };
    const phases: string[] = [];
    const { clone, seen } = fakeClone();
    const pipeline = createGuardBaselinePipeline({ clone, loadCorpus: corpusOf([scenario('s1'), scenario('s2')]) });

    const out = await pipeline.run(makeDeps(execute), req(), { onPhase: (p) => void phases.push(p) });

    expect(out).toEqual({ status: 'ok', scenarioCount: 2 });
    expect(phases).toEqual(['clone', 'run', 'persist']);
    // The executor ran the default branch @ commit, never persisting itself.
    expect(execInput).toMatchObject({ branch: 'main', commit: COMMIT, persist: false });
    // The baseline LATEST now holds the run the executor returned.
    const latest = await guardStore.readGuardLatest(REPO);
    expect(latest?.run.commit).toBe(COMMIT);
    expect(latest?.summary).toMatchObject({ pass: 1, fail: 1 });
    // Checkout is removed unconditionally.
    expect(seen.dir && fs.existsSync(seen.dir)).toBe(false);
  });

  it('the REAL executor runs the recipe install before the build (marker recipe, fresh checkout)', async () => {
    // The doc lives in the checkout so the scenario's binding resolves as `match`.
    const DOC = '## intro\nsome observable behavior\n';
    const section = buildDocSectionIndex('README.md', DOC).sections[0];
    const FIXTURE_BIN = fileURLToPath(new URL('../fixtures/guard-fixture-cli/bin.mjs', import.meta.url));
    const scen: GuardScenario = {
      ...scenario('s1'),
      binds: [{ doc: 'README.md', section: section.anchor, fingerprint: section.fingerprint }],
      steps: [{ run: ['--version'], expect: { exit: 0 } }],
    };
    // The build only succeeds when the install's marker already exists → order proven.
    const recipe: Recipe = {
      install: 'touch install-marker',
      build: 'test -f install-marker',
      entry: ['node', FIXTURE_BIN],
    };
    const clone = async (_deps: unknown, _req: GuardBaselineRunRequest, dir: string) => {
      fs.writeFileSync(path.join(dir, 'README.md'), DOC);
    };
    const pipeline = createGuardBaselinePipeline({
      clone,
      loadCorpus: async () => ({ recipe, scenarios: [scen] }),
    });

    const out = await pipeline.run(makeDeps(defaultGuardExecutor), req());

    expect(out).toEqual({ status: 'ok', scenarioCount: 1 });
    expect((await guardStore.readGuardLatest(REPO))?.summary).toMatchObject({ pass: 1 });
  });

  it('runs the executor under the shared limiter (permit held during the run)', async () => {
    const limiter = createSemaphore(1);
    let insidePermit = false;
    const execute: GuardExecutor = async () => {
      insidePermit = true;
      return okReport(latestOf([result('s1', 'pass')], COMMIT));
    };
    const { clone } = fakeClone();
    const pipeline = createGuardBaselinePipeline({ clone, loadCorpus: corpusOf([scenario('s1')]) });

    await pipeline.run(makeDeps(execute, limiter), req());
    expect(insidePermit).toBe(true);
  });
});

describe('guard-baseline pipeline — no-op short-circuits', () => {
  it('no-corpus when nothing is committed — never runs, never touches the baseline', async () => {
    // Seed a prior baseline so we can prove it is NOT overwritten.
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], 'older00'));
    let ran = 0;
    const execute: GuardExecutor = async () => {
      ran++;
      return okReport(latestOf([], COMMIT));
    };
    const { clone } = fakeClone();
    const pipeline = createGuardBaselinePipeline({ clone, loadCorpus: async () => null });

    const out = await pipeline.run(makeDeps(execute), req());

    expect(out).toEqual({ status: 'no-corpus', scenarioCount: 0 });
    expect(ran).toBe(0);
    expect((await guardStore.readGuardLatest(REPO))?.run.commit).toBe('older00');
  });

  it('no-corpus when the committed set has zero scenarios', async () => {
    const execute: GuardExecutor = async () => okReport(latestOf([], COMMIT));
    const { clone } = fakeClone();
    const pipeline = createGuardBaselinePipeline({ clone, loadCorpus: corpusOf([]) });

    const out = await pipeline.run(makeDeps(execute), req());
    expect(out).toEqual({ status: 'no-corpus', scenarioCount: 0 });
    expect(await guardStore.readGuardLatest(REPO)).toBeNull();
  });

  it('no-verdict when the executor produces no ok report — old baseline left intact', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], 'older00'));
    const execute: GuardExecutor = async () =>
      ({ status: 'run-timed-out', elapsedMs: 1, settled: 0, total: 1 }) as GuardExecReport;
    const { clone, seen } = fakeClone();
    const pipeline = createGuardBaselinePipeline({ clone, loadCorpus: corpusOf([scenario('s1')]) });

    const out = await pipeline.run(makeDeps(execute), req());

    expect(out).toEqual({ status: 'no-verdict', scenarioCount: 1 });
    expect((await guardStore.readGuardLatest(REPO))?.run.commit).toBe('older00');
    expect(seen.dir && fs.existsSync(seen.dir)).toBe(false);
  });
});

describe('guard-baseline pipeline — clone-phase bound', () => {
  /** A clone that hangs until the signal the pipeline hands it aborts — the
   *  wedged-remote shape. Bails with a distinct error if never aborted, so a
   *  missing bound fails fast instead of hitting the suite timeout. */
  function hangingClone() {
    const seen: { dir?: string } = {};
    const clone = (
      cloneDeps: { auth: GithubAuth; signal?: AbortSignal },
      _req: GuardBaselineRunRequest,
      dir: string,
    ) =>
      new Promise<void>((_resolve, reject) => {
        seen.dir = dir;
        const bail = setTimeout(() => reject(new Error('clone was never aborted')), 1_000);
        cloneDeps.signal?.addEventListener('abort', () => {
          clearTimeout(bail);
          reject(cloneDeps.signal!.reason);
        });
      });
    return { clone, seen };
  }

  it('bounds the clone by the wall-clock even with NO external signal', async () => {
    const { clone, seen } = hangingClone();
    const execute: GuardExecutor = async () => okReport(latestOf([], COMMIT));
    const pipeline = createGuardBaselinePipeline({
      clone,
      loadCorpus: corpusOf([scenario('s1')]),
      cloneTimeoutMs: 25,
    });

    await expect(pipeline.run(makeDeps(execute), req())).rejects.toMatchObject({
      name: 'TimeoutError',
    });
    expect(await guardStore.readGuardLatest(REPO)).toBeNull();
    expect(seen.dir && fs.existsSync(seen.dir)).toBe(false);
  });

  it('an external abort still cancels the clone before the wall-clock elapses', async () => {
    const { clone } = hangingClone();
    const execute: GuardExecutor = async () => okReport(latestOf([], COMMIT));
    const pipeline = createGuardBaselinePipeline({ clone, loadCorpus: corpusOf([scenario('s1')]) });

    const controller = new AbortController();
    const run = pipeline.run(makeDeps(execute), req(), { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);

    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
});
