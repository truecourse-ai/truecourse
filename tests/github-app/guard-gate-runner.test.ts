/**
 * Guard-gate pipeline: the REAL pipeline body over PGlite-backed gate/guard
 * stores, with fakes only at the network/execution seams (clone, checkout,
 * corpus load, executor). Covers the kill-switch, redelivery dedupe, the
 * diff-vs-base Check semantics (newly-failing / pre-existing / dismissed /
 * stale annotations), the lazy base run + baseline persistence, per-run
 * timeouts surfacing as error Checks, head-run + evidence persistence, the
 * executor concurrency limiter, and unconditional checkout cleanup.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type EeDb } from '@truecourse/ee-db';
import type {
  GuardLatest,
  GuardOutcome,
  GuardScenario,
  GuardScenarioResult,
} from '@truecourse/shared';
import type {
  GuardExecInput,
  GuardExecReport,
  GuardExecutor,
  Recipe,
} from '@truecourse/guard-runner';
import { PgGuardStore } from '../../ee/packages/data-store/src/index';
import { createSemaphore } from '../../ee/packages/server/src/jobs/guard-gate-limiter';
import { selectGateStore } from '../../ee/packages/github-app/src/store/index';
import type { GateStore } from '../../ee/packages/github-app/src/store/types';
import type { GithubAuth } from '../../ee/packages/github-app/src/github';
import type { RepoRef } from '@truecourse/core/lib/guard-store';
import { OpenConflictsError } from '@truecourse/core/commands/guard-in-process';
import {
  createGuardGatePipeline,
  cloneAbortSignal,
  InvalidGuardRecipeError,
  GUARD_GATE_RUN_TIMEOUT_MS,
  GUARD_GATE_BUILD_TIMEOUT_MS,
  GUARD_GATE_CLONE_TIMEOUT_MS,
  type GuardGateClone,
  type GuardGateCheckoutRequest,
  type GuardGatePipelineDeps,
  type GuardGateRunRequest,
} from '../../ee/packages/github-app/src/guard-gate-runner';

const REPO = 'acme/api';
const BASE_SHA = 'base1234567890';
const HEAD_SHA = 'head1234567890';
const KILL_SWITCH = 'TRUECOURSE_GUARD_GATE_DISABLED';

const RECIPE: Recipe = { build: 'npm run build', entry: ['node', 'cli.js'] };

function scenario(id: string, section = 'intro'): GuardScenario {
  return {
    id,
    title: `t-${id}`,
    binds: [{ doc: 'README.md', section, fingerprint: 'sha256:f' }],
    steps: [{ run: ['--help'], expect: { exit: 0 } }],
    normalize: [],
  };
}

function result(
  id: string,
  outcome: GuardOutcome,
  over: Partial<GuardScenarioResult> = {},
): GuardScenarioResult {
  return {
    id,
    title: `t-${id}`,
    binds: { doc: 'README.md', section: 'intro', fingerprint: 'sha256:f' },
    outcome,
    durationMs: 1,
    ...over,
  };
}

function latestOf(
  scenarios: GuardScenarioResult[],
  commit: string,
  runId = `run-${commit}`,
): GuardLatest {
  const summary = { total: scenarios.length, pass: 0, fail: 0, stale: 0, orphaned: 0, error: 0 };
  for (const s of scenarios) summary[s.outcome] += 1;
  return {
    run: {
      runId,
      ranAt: '2026-07-10T00:00:00.000Z',
      branch: 'main',
      commit,
      recipeFingerprint: 'sha256:r',
    },
    summary,
    scenarios,
    sections: [],
  };
}

function okReport(latest: GuardLatest): GuardExecReport {
  return { status: 'ok', latest, latestPath: '', loadErrors: [], manifest: null };
}

function payload(over: Partial<GuardGateRunRequest> = {}): GuardGateRunRequest {
  return {
    repoFullName: REPO,
    installationId: 42,
    workspaceOrgId: 'org_A',
    prNumber: 7,
    defaultBranch: 'main',
    baseBranch: 'main',
    baseSha: BASE_SHA,
    headSha: HEAD_SHA,
    headRef: 'feature/x',
    isFork: false,
    checkRunId: 9001,
    ...over,
  };
}

/** Fake octokit capturing completed Checks (create-completed and update alike). */
function makeOctokit() {
  const calls = { check: [] as any[], checkStart: [] as any[] };
  const checkRuns = new Map<number, any>();
  let nextCheckId = 1000;
  const octokit: any = {
    checks: {
      create: async (p: any) => {
        const id = ++nextCheckId;
        if (p.status === 'in_progress') {
          calls.checkStart.push(p);
          checkRuns.set(id, p);
        } else {
          calls.check.push(p);
        }
        return { data: { id } };
      },
      update: async (p: any) => {
        const created = checkRuns.get(p.check_run_id) ?? {};
        calls.check.push({ ...p, head_sha: created.head_sha, name: created.name });
        return { data: { id: p.check_run_id } };
      },
    },
  };
  return { octokit, calls };
}

function writeFile(root: string, rel: string, body: string): void {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

/** Records the checkout request + scratch dir; optionally seeds files into it. */
function fakeClone(write: Record<string, string> = {}) {
  const seen: { req?: GuardGateCheckoutRequest; dir?: string } = {};
  const clone: GuardGateClone = async (_deps, req, dir) => {
    seen.req = req;
    seen.dir = dir;
    for (const [rel, body] of Object.entries(write)) writeFile(dir, rel, body);
    return { baseSha: BASE_SHA, headSha: HEAD_SHA };
  };
  return { clone, seen };
}

function fakeCheckout() {
  const switched: Array<{ dir: string; sha: string }> = [];
  return { checkout: async (dir: string, sha: string) => void switched.push({ dir, sha }), switched };
}

let client: PGlite;
let db: EeDb;
let guardStore: PgGuardStore;
let gateStore: GateStore;
let savedKillSwitch: string | undefined;

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as EeDb;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  guardStore = new PgGuardStore(db);
  gateStore = selectGateStore(db);
  await gateStore.linkRepo({
    repoFullName: REPO,
    installationId: 42,
    workspaceOrgId: 'org_A',
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  });
  savedKillSwitch = process.env[KILL_SWITCH];
  delete process.env[KILL_SWITCH];
});

afterEach(async () => {
  if (savedKillSwitch === undefined) delete process.env[KILL_SWITCH];
  else process.env[KILL_SWITCH] = savedKillSwitch;
  await client.close();
});

function makeDeps(execute: GuardExecutor) {
  const { octokit, calls } = makeOctokit();
  const deps: GuardGatePipelineDeps = {
    store: gateStore,
    guardStore,
    auth: {} as GithubAuth,
    octokitFor: () => octokit,
    execute,
    limiter: { run: (fn) => fn() },
  };
  return { deps, calls };
}

const corpus = (scenarios: GuardScenario[]) => async () => ({ recipe: RECIPE, scenarios });

const neverExecute: GuardExecutor = async () => {
  throw new Error('the executor must not run');
};

describe('guard-gate pipeline — kill switch', () => {
  it('posts a neutral disabled Check without cloning, loading, or running anything', async () => {
    process.env[KILL_SWITCH] = '1';
    let cloned = 0;
    let loaded = 0;
    const pipeline = createGuardGatePipeline({
      clone: async () => {
        cloned++;
        return { baseSha: BASE_SHA, headSha: HEAD_SHA };
      },
      loadCorpus: async () => {
        loaded++;
        return null;
      },
      checkout: async () => {},
    });
    const { deps, calls } = makeDeps(neverExecute);

    const decision = await pipeline.run(deps, payload());

    expect(decision.conclusion).toBe('neutral');
    expect(cloned).toBe(0);
    expect(loaded).toBe(0);
    expect(calls.check).toHaveLength(1);
    expect(calls.check[0].conclusion).toBe('neutral');
    expect(calls.check[0].output.title).toBe('Guard gate disabled');
    expect(calls.check[0].output.summary).toContain('TRUECOURSE_GUARD_GATE_DISABLED');
    expect(calls.check[0].check_run_id).toBe(9001);
  });
});

describe('guard-gate pipeline — redelivery fast path', () => {
  it('decides from the stored head run without cloning or executing', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    await guardStore.writeGuardRun(REPO, latestOf([result('s1', 'fail')], HEAD_SHA));
    let cloned = 0;
    const pipeline = createGuardGatePipeline({
      clone: async () => {
        cloned++;
        return { baseSha: BASE_SHA, headSha: HEAD_SHA };
      },
      loadCorpus: corpus([scenario('s1')]),
      checkout: async () => {},
    });
    const { deps, calls } = makeDeps(neverExecute);

    const decision = await pipeline.run(deps, payload());

    expect(cloned).toBe(0);
    expect(decision.conclusion).toBe('failure');
    expect(calls.check).toHaveLength(1);
    expect(calls.check[0].conclusion).toBe('failure');
    expect(calls.check[0].output.title).toBe('1 newly failing guard scenario');
  });
});

describe('guard-gate pipeline — diff semantics end-to-end', () => {
  function pipelineWith(scenarios: GuardScenario[], write: Record<string, string> = {}) {
    const { clone, seen } = fakeClone(write);
    const { checkout, switched } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus(scenarios), checkout });
    return { pipeline, seen, switched };
  }

  it('fails the Check for pass-on-base / fail-on-head, and persists the head run', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const execCalls: GuardExecInput[] = [];
    const execute: GuardExecutor = async (input) => {
      execCalls.push(input);
      return okReport(latestOf([result('s1', 'fail')], input.commit ?? ''));
    };
    const { pipeline } = pipelineWith([scenario('s1')]);
    const { deps, calls } = makeDeps(execute);

    const decision = await pipeline.run(deps, payload());

    expect(decision.conclusion).toBe('failure');
    expect(calls.check[0].conclusion).toBe('failure');
    // One execute (the head): the base came from the stored baseline.
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].commit).toBe(HEAD_SHA);
    // Head run persisted keyed by headSha, NOT as the baseline (decision 5).
    const persisted = await guardStore.readGuardRunForCommit(REPO, HEAD_SHA);
    expect(persisted?.scenarios[0]?.outcome).toBe('fail');
    expect((await guardStore.readGuardLatest(REPO))?.run.commit).toBe(BASE_SHA);
  });

  it('pre-existing red (fail on both sides) succeeds', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'fail')], BASE_SHA));
    const { pipeline } = pipelineWith([scenario('s1')]);
    const { deps, calls } = makeDeps(async (input) =>
      okReport(latestOf([result('s1', 'fail')], input.commit ?? '')),
    );

    const decision = await pipeline.run(deps, payload());

    expect(decision.conclusion).toBe('success');
    expect(calls.check[0].conclusion).toBe('success');
    expect(calls.check[0].output.summary).toContain('1 pre-existing failure');
  });

  it('excludes dismissed claims — repo scope and the PR overlay both fold in', async () => {
    await guardStore.writeGuardLatest(
      REPO,
      latestOf([result('s1', 'pass'), result('s2', 'pass')], BASE_SHA),
    );
    // s1 dismissed at the repo scope; s2 in this PR's overlay.
    await guardStore.writeGuardDecisions(REPO, {
      version: 1,
      dismissedClaims: [
        { doc: 'README.md', anchor: 'intro', title: 't-s1', dismissedAt: '2026-07-01T00:00:00.000Z' },
      ],
    });
    await guardStore.writeGuardDecisions(
      REPO,
      {
        version: 1,
        dismissedClaims: [
          { doc: 'README.md', anchor: 'intro', title: 't-s2', dismissedAt: '2026-07-01T00:00:00.000Z' },
        ],
      },
      '_pr/7',
    );
    const { pipeline } = pipelineWith([scenario('s1'), scenario('s2')]);
    const { deps, calls } = makeDeps(async (input) =>
      okReport(latestOf([result('s1', 'fail'), result('s2', 'fail')], input.commit ?? '')),
    );

    const decision = await pipeline.run(deps, payload());

    expect(decision.conclusion).toBe('success');
    expect(decision.diff.excluded.map((s) => s.id).sort()).toEqual(['s1', 's2']);
    expect(calls.check[0].output.summary).toContain('2 dismissed scenarios excluded');
  });

  it('stale/orphaned scenarios annotate the checked-out doc at their live section lines', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const readme = '# Title\nintro text\n## Install\nstep one\nstep two\n';
    const { pipeline } = pipelineWith([scenario('s1')], { 'README.md': readme });
    const stale = result('s1', 'stale', {
      binds: { doc: 'README.md', section: 'title/install', fingerprint: 'sha256:old' },
      currentFingerprint: 'sha256:new',
    });
    const orphaned = result('s2', 'orphaned', {
      binds: { doc: 'README.md', section: 'gone', fingerprint: 'sha256:g' },
    });
    const { deps, calls } = makeDeps(async (input) =>
      okReport(latestOf([stale, orphaned], input.commit ?? '')),
    );

    const decision = await pipeline.run(deps, payload());

    // Stale bindings never fail the Check.
    expect(decision.conclusion).toBe('success');
    const annotations = calls.check[0].output.annotations;
    expect(annotations).toHaveLength(2);
    expect(annotations[0]).toEqual({
      path: 'README.md',
      start_line: 3,
      end_line: 5,
      annotation_level: 'warning',
      title: 'Guard scenario stale',
      message: expect.stringContaining('README.md#title/install'),
    });
    // An unresolvable anchor falls back to line 1.
    expect(annotations[1]).toMatchObject({
      path: 'README.md',
      start_line: 1,
      end_line: 1,
      title: 'Guard scenario orphaned',
    });
  });

  it('threads the PRD timeouts + persist:false + the exact committed corpus into the executor', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const committed = [scenario('s1'), scenario('s2')];
    const execCalls: GuardExecInput[] = [];
    const { pipeline } = pipelineWith(committed);
    const { deps } = makeDeps(async (input) => {
      execCalls.push(input);
      return okReport(latestOf([result('s1', 'pass'), result('s2', 'pass')], input.commit ?? ''));
    });

    await pipeline.run(deps, payload());

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].runTimeoutMs).toBe(15 * 60_000);
    expect(execCalls[0].buildTimeoutMs).toBe(10 * 60_000);
    expect(GUARD_GATE_RUN_TIMEOUT_MS).toBe(900_000);
    expect(GUARD_GATE_BUILD_TIMEOUT_MS).toBe(600_000);
    expect(execCalls[0].persist).toBe(false);
    expect(execCalls[0].commit).toBe(HEAD_SHA);
    expect(execCalls[0].branch).toBe('feature/x');
    // Decision 2: the gate runs EXACTLY the committed corpus — nothing held, nothing extra.
    expect(execCalls[0].scenarios).toBe(committed);
    expect(execCalls[0].recipe).toBe(RECIPE);
  });
});

describe('guard-gate pipeline — base resolution', () => {
  it('lazy-runs the base on the gate checkout when nothing is stored, and persists it as the baseline (base === default)', async () => {
    const execCalls: GuardExecInput[] = [];
    const execute: GuardExecutor = async (input) => {
      execCalls.push(input);
      const outcome = input.commit === BASE_SHA ? 'pass' : 'fail';
      return okReport(latestOf([result('s1', outcome)], input.commit ?? ''));
    };
    const { clone, seen } = fakeClone();
    const { checkout, switched } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps, calls } = makeDeps(execute);

    const decision = await pipeline.run(deps, payload());

    // Two executes on the SAME checkout dir: base first, then head.
    expect(execCalls.map((c) => c.commit)).toEqual([BASE_SHA, HEAD_SHA]);
    expect(execCalls[0].checkoutDir).toBe(seen.dir);
    expect(execCalls[1].checkoutDir).toBe(seen.dir);
    // The tree advances to the head only after the base run.
    expect(switched).toEqual([{ dir: seen.dir, sha: HEAD_SHA }]);
    // The lazy base run became the repo baseline (decision 4).
    const baseline = await guardStore.readGuardLatest(REPO);
    expect(baseline?.run.commit).toBe(BASE_SHA);
    // And the diff used it: pass on base, fail on head → failure.
    expect(decision.conclusion).toBe('failure');
    expect(calls.check[0].conclusion).toBe('failure');
  });

  it('a non-default base lazy run stays ephemeral (no baseline row)', async () => {
    const execute: GuardExecutor = async (input) =>
      okReport(latestOf([result('s1', 'pass')], input.commit ?? ''));
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps } = makeDeps(execute);

    await pipeline.run(deps, payload({ baseBranch: 'release/1.x', baseSha: 'rel1234567890' }));

    expect(await guardStore.readGuardLatest(REPO)).toBeNull();
  });

  it('reuses an exact-commit stored run for the base (no lazy run)', async () => {
    // A non-baseline row stored under the base sha (e.g. it was once a PR head).
    await guardStore.writeGuardRun(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const execCalls: GuardExecInput[] = [];
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps, calls } = makeDeps(async (input) => {
      execCalls.push(input);
      return okReport(latestOf([result('s1', 'fail')], input.commit ?? ''));
    });

    await pipeline.run(deps, payload());

    expect(execCalls.map((c) => c.commit)).toEqual([HEAD_SHA]);
    expect(calls.check[0].conclusion).toBe('failure');
  });
});

describe('guard-gate pipeline — fork PRs', () => {
  it('the clone seam receives only the base repo + pull ref coordinates (read-only path)', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const { clone, seen } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps } = makeDeps(async (input) =>
      okReport(latestOf([result('s1', 'pass')], input.commit ?? '')),
    );

    await pipeline.run(deps, payload({ isFork: true, headRef: 'fork-feature' }));

    // The request carries no fork-repo URL or ref — the pull ref in the BASE repo
    // is the only fetch target, so the gate never touches the fork remote.
    expect(seen.req).toEqual({
      repoFullName: REPO,
      installationId: 42,
      baseBranch: 'main',
      prNumber: 7,
    });
  });
});

describe('guard-gate pipeline — engine failures and cleanup', () => {
  it('run-timed-out posts an error-styled FAILURE Check and removes the checkout', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const { clone, seen } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps, calls } = makeDeps(async () => ({
      status: 'run-timed-out',
      elapsedMs: 900_001,
      settled: 0,
      total: 1,
    }));

    const decision = await pipeline.run(deps, payload());

    expect(decision.conclusion).toBe('error');
    expect(calls.check[0].conclusion).toBe('failure');
    expect(calls.check[0].output.title).toBe('Gate error — run timed out (no verdict)');
    expect(fs.existsSync(seen.dir!)).toBe(false);
    // Nothing persisted for the head — a redelivery re-runs it.
    expect(await guardStore.readGuardRunForCommit(REPO, HEAD_SHA)).toBeNull();
  });

  it('a timed-out build posts the build-timed-out error Check', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps, calls } = makeDeps(async () => ({
      status: 'build-failed',
      build: { ok: false, command: 'npm run build', exitCode: null, timedOut: true, output: '' },
      loadErrors: [],
    }));

    const decision = await pipeline.run(deps, payload());

    expect(decision.conclusion).toBe('error');
    expect(calls.check[0].conclusion).toBe('failure');
    expect(calls.check[0].output.title).toBe('Gate error — build timed out (no verdict)');
  });

  it('removes the checkout even when the clone itself throws', async () => {
    let dir: string | undefined;
    const pipeline = createGuardGatePipeline({
      clone: async (_deps, _req, d) => {
        dir = d;
        throw new Error('clone exploded');
      },
      loadCorpus: corpus([scenario('s1')]),
      checkout: async () => {},
    });
    const { deps } = makeDeps(neverExecute);

    await expect(pipeline.run(deps, payload())).rejects.toThrow('clone exploded');
    expect(dir).toBeDefined();
    expect(fs.existsSync(dir!)).toBe(false);
  });
});

describe('guard-gate pipeline — corpus-absent neutral', () => {
  it('no corpus at all → neutral no-scenarios Check, executor never called', async () => {
    const { clone } = fakeClone();
    const pipeline = createGuardGatePipeline({
      clone,
      loadCorpus: async () => null,
      checkout: async () => {},
    });
    const { deps, calls } = makeDeps(neverExecute);

    const decision = await pipeline.run(deps, payload());

    expect(decision.conclusion).toBe('neutral');
    expect(decision.neutralReason).toBe('no-scenarios');
    expect(calls.check[0].conclusion).toBe('neutral');
    expect(calls.check[0].output.title).toBe('No guard scenarios to run');
  });

  it('a corpus with zero scenarios is the same neutral', async () => {
    const { clone } = fakeClone();
    const pipeline = createGuardGatePipeline({
      clone,
      loadCorpus: corpus([]),
      checkout: async () => {},
    });
    const { deps, calls } = makeDeps(neverExecute);

    const decision = await pipeline.run(deps, payload());

    expect(decision.neutralReason).toBe('no-scenarios');
    expect(calls.check[0].conclusion).toBe('neutral');
  });
});

describe('guard-gate pipeline — default corpus load (store-backed)', () => {
  const SCENARIO_YAML = [
    'id: s1',
    'title: t-s1',
    'binds:',
    '  - doc: README.md',
    '    section: intro',
    '    fingerprint: "sha256:f"',
    'driver: cli',
    'steps:',
    '  - run: ["--help"]',
    '    expect:',
    '      exit: 0',
    '',
  ].join('\n');

  async function saveCorpus(commitSha: string, recipeBody: string): Promise<void> {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-gate-corpus-src-'));
    try {
      writeFile(src, 'recipe.json', recipeBody);
      writeFile(src, 'cli/s1.yaml', SCENARIO_YAML);
      await guardStore.saveScenarios({ repoKey: REPO, commitSha }, src);
    } finally {
      fs.rmSync(src, { recursive: true, force: true });
    }
  }

  it('loads the stored recipe + scenarios keyed by the repo baseline commit', async () => {
    await saveCorpus('corpussha123', JSON.stringify(RECIPE));
    await gateStore.saveBaseline({
      repoFullName: REPO,
      commitSha: 'corpussha123',
      drifts: [],
      capturedAt: '2026-07-01T00:00:00.000Z',
    });
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const execCalls: GuardExecInput[] = [];
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, checkout }); // no loadCorpus seam
    const { deps, calls } = makeDeps(async (input) => {
      execCalls.push(input);
      return okReport(latestOf([result('s1', 'pass')], input.commit ?? ''));
    });

    const decision = await pipeline.run(deps, payload());

    expect(decision.conclusion).toBe('success');
    expect(calls.check[0].conclusion).toBe('success');
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].recipe).toEqual(RECIPE);
    expect(execCalls[0].scenarios.map((s) => s.id)).toEqual(['s1']);
  });

  it('falls back to the newest stored set when the baseline commit has none (re-baseline without regen)', async () => {
    await saveCorpus('oldsha1234567', JSON.stringify(RECIPE));
    // The baseline moved (a merge re-baselined) but scenarios were never regenerated.
    await gateStore.saveBaseline({
      repoFullName: REPO,
      commitSha: 'newsha1234567',
      drifts: [],
      capturedAt: '2026-07-02T00:00:00.000Z',
    });
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const execCalls: GuardExecInput[] = [];
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, checkout });
    const { deps } = makeDeps(async (input) => {
      execCalls.push(input);
      return okReport(latestOf([result('s1', 'pass')], input.commit ?? ''));
    });

    await pipeline.run(deps, payload());

    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].scenarios.map((s) => s.id)).toEqual(['s1']);
  });

  it('a committed-but-unparseable recipe is an error Check (invalid-recipe), never neutral', async () => {
    await saveCorpus('corpussha123', '{ not json');
    await gateStore.saveBaseline({
      repoFullName: REPO,
      commitSha: 'corpussha123',
      drifts: [],
      capturedAt: '2026-07-01T00:00:00.000Z',
    });
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, checkout });
    const { deps, calls } = makeDeps(neverExecute);

    const decision = await pipeline.run(deps, payload());

    expect(decision.conclusion).toBe('error');
    expect(decision.errorReason).toBe('infra');
    expect(calls.check[0].conclusion).toBe('failure');
    expect(calls.check[0].output.title).toBe('Gate error — gate infrastructure failed (no verdict)');
  });
});

describe('guard-gate pipeline — head-run evidence persistence', () => {
  it('copies failure transcripts out of the checkout into the guard store before cleanup', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const runId = 'run-evidence1';
    const { deps } = makeDeps(async (input) => {
      // Simulate what a real run leaves in the checkout: the failing scenario's
      // evidence bundle under its evidencePath pointer.
      const rel = `.truecourse/guard/evidence/${runId}/s1`;
      writeFile(input.checkoutDir, `${rel}/transcript.txt`, 'step 1 failed\n');
      writeFile(input.checkoutDir, `${rel}/diff.txt`, 'expected 0, got 1\n');
      return okReport(
        latestOf([result('s1', 'fail', { evidencePath: rel })], input.commit ?? '', runId),
      );
    });

    await pipeline.run(deps, payload());

    expect(await guardStore.readGuardEvidence(REPO, runId, 's1', 'transcript.txt')).toBe(
      'step 1 failed\n',
    );
    expect(await guardStore.readGuardEvidence(REPO, runId, 's1', 'diff.txt')).toBe(
      'expected 0, got 1\n',
    );
  });
});

describe('guard-gate pipeline — persistence ordering (a store failure must never flip a posted Check)', () => {
  it('persists the head run BEFORE posting the conclusion — a persistence failure leaves the verdict unposted', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps, calls } = makeDeps(async (input) =>
      okReport(latestOf([result('s1', 'pass')], input.commit ?? '')),
    );
    deps.guardStore.writeGuardRun = async () => {
      throw new Error('store down');
    };

    await expect(pipeline.run(deps, payload())).rejects.toThrow('store down');

    // No verdict Check was posted: the job wrapper's infra-error Check is the
    // ONLY conclusion, so a green verdict can never be re-completed as red.
    expect(calls.check).toHaveLength(0);
  });

  it('an evidence persistence failure leaves the verdict unposted too (run row already written)', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const runId = 'run-ev-order';
    const { deps, calls } = makeDeps(async (input) => {
      const rel = `.truecourse/guard/evidence/${runId}/s1`;
      writeFile(input.checkoutDir, `${rel}/transcript.txt`, 'failed\n');
      return okReport(
        latestOf([result('s1', 'fail', { evidencePath: rel })], input.commit ?? '', runId),
      );
    });
    deps.guardStore.writeGuardEvidence = async () => {
      throw new Error('evidence store down');
    };

    await expect(pipeline.run(deps, payload())).rejects.toThrow('evidence store down');

    expect(calls.check).toHaveLength(0);
    // Ordering constraint held: the run row was written before evidence failed.
    expect(await guardStore.readGuardRunForCommit(REPO, HEAD_SHA)).not.toBeNull();
  });
});

describe('guard-gate pipeline — cancellation (AbortSignal)', () => {
  it('threads run() opts.signal into EVERY executor call (lazy base run and head run) and the clone/checkout seams', async () => {
    // No stored base → the pipeline lazy-runs the base, then the head: two executes.
    const controller = new AbortController();
    const execSignals: Array<AbortSignal | undefined> = [];
    const execute: GuardExecutor = async (input) => {
      execSignals.push(input.signal);
      return okReport(latestOf([result('s1', 'pass')], input.commit ?? ''));
    };
    let cloneSignal: AbortSignal | undefined;
    let checkoutSignal: AbortSignal | undefined;
    const clone: GuardGateClone = async (deps, _req, _dir) => {
      cloneSignal = deps.signal;
      return { baseSha: BASE_SHA, headSha: HEAD_SHA };
    };
    const pipeline = createGuardGatePipeline({
      clone,
      loadCorpus: corpus([scenario('s1')]),
      checkout: async (_dir, _sha, signal) => void (checkoutSignal = signal),
    });
    const { deps } = makeDeps(execute);

    await pipeline.run(deps, payload(), { signal: controller.signal });

    expect(execSignals).toHaveLength(2);
    expect(execSignals[0]).toBe(controller.signal);
    expect(execSignals[1]).toBe(controller.signal);
    expect(cloneSignal).toBe(controller.signal);
    expect(checkoutSignal).toBe(controller.signal);
  });

  it('an abort mid-run posts the error-styled FAILURE Check and removes the checkout', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const controller = new AbortController();
    const execute: GuardExecutor = async (input) => {
      controller.abort();
      // What the real executor reports once its signal fires mid-run.
      expect(input.signal?.aborted).toBe(true);
      return { status: 'aborted', phase: 'run' };
    };
    const { clone, seen } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps, calls } = makeDeps(execute);

    const decision = await pipeline.run(deps, payload(), { signal: controller.signal });

    expect(decision.conclusion).toBe('error');
    expect(decision.errorReason).toBe('aborted');
    expect(calls.check[0].conclusion).toBe('failure');
    expect(calls.check[0].output.title).toBe('Gate error — run aborted (no verdict)');
    expect(fs.existsSync(seen.dir!)).toBe(false);
    // Nothing persisted for the head — a redelivery re-runs it.
    expect(await guardStore.readGuardRunForCommit(REPO, HEAD_SHA)).toBeNull();
  });

  it('still accepts the onPhase-only options bag (backward compatible)', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const phases: string[] = [];
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps } = makeDeps(async (input) =>
      okReport(latestOf([result('s1', 'pass')], input.commit ?? '')),
    );

    await pipeline.run(deps, payload(), { onPhase: (p) => void phases.push(p) });

    expect(phases).toEqual(['clone', 'base', 'run', 'verdict']);
  });
});

describe('guard-gate clone-phase timeout', () => {
  it('is a 5-minute constant (no new env var — PRD allows only the kill switch)', () => {
    expect(GUARD_GATE_CLONE_TIMEOUT_MS).toBe(5 * 60_000);
  });

  it('cloneAbortSignal aborts once the clone wall-clock elapses', async () => {
    const signal = cloneAbortSignal(undefined, 5);
    expect(signal.aborted).toBe(false);
    await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
    expect(signal.aborted).toBe(true);
  });

  it('cloneAbortSignal is already aborted when the external signal is', () => {
    const controller = new AbortController();
    controller.abort();
    expect(cloneAbortSignal(controller.signal).aborted).toBe(true);
  });

  it('cloneAbortSignal folds an external abort in before the timeout fires', () => {
    const controller = new AbortController();
    const signal = cloneAbortSignal(controller.signal, 60_000);
    expect(signal.aborted).toBe(false);
    controller.abort();
    expect(signal.aborted).toBe(true);
  });
});

describe('guard-gate pipeline — cold-generate on a scenario miss', () => {
  it('generates on the base checkout when nothing is stored, runs it in the same pass, and gates', async () => {
    // No stored corpus anywhere → loadCorpus misses → the cold path fires.
    const coldCalls: Array<{ ref: RepoRef; dir: string }> = [];
    const { clone, seen } = fakeClone();
    const { checkout, switched } = fakeCheckout();
    const execCalls: GuardExecInput[] = [];
    const pipeline = createGuardGatePipeline({
      clone,
      loadCorpus: async () => null,
      coldGenerate: async (ref, dir) => {
        coldCalls.push({ ref, dir });
        return { recipe: RECIPE, scenarios: [scenario('s1')] };
      },
      checkout,
    });
    const { deps, calls } = makeDeps(async (input) => {
      execCalls.push(input);
      const outcome = input.commit === BASE_SHA ? 'pass' : 'fail';
      return okReport(latestOf([result('s1', outcome)], input.commit ?? ''));
    });

    const decision = await pipeline.run(deps, payload());

    // Cold-generated on the base commit, in the gate's own checkout (AC1).
    expect(coldCalls).toHaveLength(1);
    expect(coldCalls[0].ref).toEqual({ repoKey: REPO, commitSha: BASE_SHA });
    expect(coldCalls[0].dir).toBe(seen.dir);
    // The freshly generated corpus ran base then head in the SAME pass.
    expect(execCalls.map((c) => c.commit)).toEqual([BASE_SHA, HEAD_SHA]);
    expect(switched).toEqual([{ dir: seen.dir, sha: HEAD_SHA }]);
    expect(decision.conclusion).toBe('failure');
    expect(calls.check[0].conclusion).toBe('failure');
  });

  it('does NOT cold-generate on the warm path (a stored corpus short-circuits it) (AC4)', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    let cold = 0;
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({
      clone,
      loadCorpus: corpus([scenario('s1')]),
      coldGenerate: async () => {
        cold++;
        return null;
      },
      checkout,
    });
    const { deps } = makeDeps(async (input) =>
      okReport(latestOf([result('s1', 'pass')], input.commit ?? '')),
    );

    await pipeline.run(deps, payload());

    expect(cold).toBe(0);
  });

  it('a cold-generate that finds no spec docs (null) stays neutral no-scenarios (AC2)', async () => {
    const { clone } = fakeClone();
    const pipeline = createGuardGatePipeline({
      clone,
      loadCorpus: async () => null,
      coldGenerate: async () => null,
      checkout: async () => {},
    });
    const { deps, calls } = makeDeps(neverExecute);

    const decision = await pipeline.run(deps, payload());

    expect(decision.conclusion).toBe('neutral');
    expect(decision.neutralReason).toBe('no-scenarios');
    expect(calls.check[0].conclusion).toBe('neutral');
  });

  it('a cold-generate failure propagates (→ the job error Check) and removes the checkout (AC2)', async () => {
    const { clone, seen } = fakeClone();
    const pipeline = createGuardGatePipeline({
      clone,
      loadCorpus: async () => null,
      coldGenerate: async () => {
        throw new Error('LLM upstream 500');
      },
      checkout: async () => {},
    });
    const { deps } = makeDeps(neverExecute);

    await expect(pipeline.run(deps, payload())).rejects.toThrow('LLM upstream 500');
    expect(fs.existsSync(seen.dir!)).toBe(false);
  });

  it('a cold-generate blocked on open spec conflicts settles NEUTRAL (not error), executor never runs', async () => {
    const { clone, seen } = fakeClone();
    const pipeline = createGuardGatePipeline({
      clone,
      loadCorpus: async () => null,
      coldGenerate: async () => {
        throw new OpenConflictsError([
          { area: 'cli', a: 'docs/a.md', b: 'docs/b.md', note: 'contradict' },
          { area: 'api', a: 'docs/c.md', b: 'docs/d.md' },
        ]);
      },
      checkout: async () => {},
    });
    const { deps, calls } = makeDeps(neverExecute);

    const decision = await pipeline.run(deps, payload());

    // Neutral, NOT the error bucket — a pending resolution isn't a broken gate.
    expect(decision.conclusion).toBe('neutral');
    expect(decision.errorReason).toBeUndefined();
    expect(calls.check[0].conclusion).toBe('neutral');
    expect(calls.check[0].output.title).toBe('Scenario generation pending — spec conflicts');
    expect(calls.check[0].output.summary).toContain('2 open conflict');
    expect(calls.check[0].output.summary).toContain('Spec Guard');
    // The checkout is still cleaned up.
    expect(fs.existsSync(seen.dir!)).toBe(false);
  });

  it('does not cold-generate when the stored recipe is unparseable (invalid-recipe stays an error)', async () => {
    let cold = 0;
    const { clone } = fakeClone();
    const pipeline = createGuardGatePipeline({
      clone,
      loadCorpus: async () => {
        throw new InvalidGuardRecipeError('bad recipe');
      },
      coldGenerate: async () => {
        cold++;
        return null;
      },
      checkout: async () => {},
    });
    const { deps, calls } = makeDeps(neverExecute);

    const decision = await pipeline.run(deps, payload());

    expect(cold).toBe(0);
    expect(decision.conclusion).toBe('error');
    expect(decision.errorReason).toBe('infra');
    expect(calls.check[0].output.title).toBe('Gate error — gate infrastructure failed (no verdict)');
  });
});

describe('guard-gate pipeline — force re-gate (spec-change checkbox)', () => {
  it('runs the injected corpus for BOTH base and head, ignoring the stored baseline, and never moves it', async () => {
    // A stored baseline exists (computed from the ORIGINAL corpus) — a force
    // re-gate must NOT diff against it (different corpus → mismatched ids).
    await guardStore.writeGuardLatest(REPO, latestOf([result('old', 'pass')], BASE_SHA));
    const execCalls: GuardExecInput[] = [];
    const execute: GuardExecutor = async (input) => {
      execCalls.push(input);
      // The PR's regenerated scenario passes on base, fails on head.
      const outcome = input.commit === BASE_SHA ? 'pass' : 'fail';
      return okReport(latestOf([result('s1', outcome)], input.commit ?? ''));
    };
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps, calls } = makeDeps(execute);

    const decision = await pipeline.run(deps, payload(), { force: true });

    // Base + head both executed with the injected (regenerated) corpus.
    expect(execCalls.map((c) => c.commit)).toEqual([BASE_SHA, HEAD_SHA]);
    // Apples-to-apples: s1 passes on base, fails on head → newly failing.
    expect(decision.conclusion).toBe('failure');
    expect(calls.check[0].output.title).toBe('1 newly failing guard scenario');
    // The repo baseline is untouched (still the original 'old' scenario).
    expect((await guardStore.readGuardLatest(REPO))?.scenarios[0]?.id).toBe('old');
  });

  it('bypasses the redelivery fast path — re-executes even with a stored run for the head', async () => {
    await guardStore.writeGuardRun(REPO, latestOf([result('s1', 'pass')], HEAD_SHA));
    const execCalls: GuardExecInput[] = [];
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps } = makeDeps(async (input) => {
      execCalls.push(input);
      return okReport(latestOf([result('s1', 'pass')], input.commit ?? ''));
    });

    await pipeline.run(deps, payload(), { force: true });

    // The stored head run did NOT short-circuit — the head was re-executed.
    expect(execCalls.some((c) => c.commit === HEAD_SHA)).toBe(true);
  });
});

describe('guard-gate pipeline — a force (spec-regen) run must not poison the redelivery fast path', () => {
  const SCENARIO_YAML = [
    'id: s1',
    'title: t-s1',
    'binds:',
    '  - doc: README.md',
    '    section: intro',
    '    fingerprint: "sha256:f"',
    'driver: cli',
    'steps:',
    '  - run: ["--help"]',
    '    expect:',
    '      exit: 0',
    '',
  ].join('\n');

  /** Commit the committed corpus (recipe + scenario s1) under the repo baseline. */
  async function seedCommittedCorpus(): Promise<void> {
    const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-guard-gate-corpus-src-'));
    try {
      writeFile(src, 'recipe.json', JSON.stringify(RECIPE));
      writeFile(src, 'cli/s1.yaml', SCENARIO_YAML);
      await guardStore.saveScenarios({ repoKey: REPO, commitSha: 'corpussha123' }, src);
    } finally {
      fs.rmSync(src, { recursive: true, force: true });
    }
    await gateStore.saveBaseline({
      repoFullName: REPO,
      commitSha: 'corpussha123',
      drifts: [],
      capturedAt: '2026-07-01T00:00:00.000Z',
    });
  }

  it('a redelivery after a force re-gate re-runs the head with the committed corpus instead of diffing mismatched scenario sets', async () => {
    await seedCommittedCorpus();
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));

    // Leg 1 — the force re-gate (the worker's regate): the PR's REGENERATED
    // corpus (scenario r1, ids disjoint from the committed set) is injected via
    // loadCorpus; r1 passes on base, fails on head → the force run concludes
    // failure and persists the head run computed from the regenerated corpus.
    const regenCorpus = { recipe: RECIPE, scenarios: [scenario('r1')] };
    const forceExecute: GuardExecutor = async (input) =>
      okReport(latestOf([result('r1', input.commit === BASE_SHA ? 'pass' : 'fail')], input.commit ?? ''));
    {
      const { clone } = fakeClone();
      const { checkout } = fakeCheckout();
      const forcePipeline = createGuardGatePipeline({
        clone,
        loadCorpus: async () => regenCorpus,
        checkout,
      });
      const { deps, calls } = makeDeps(forceExecute);
      const decision = await forcePipeline.run(deps, payload(), { force: true });
      expect(decision.conclusion).toBe('failure');
      expect(calls.check[0].conclusion).toBe('failure');
    }

    // Leg 2 — the author closes/reopens: a plain redelivery on the DEFAULT
    // corpus resolution. The stored head run came from a different corpus, so
    // the fast path must NOT diff it against the committed-corpus baseline
    // (r1 has no base counterpart → everything buckets pre-existing → green).
    // Instead the head is re-run with the committed corpus: s1 fails → red.
    const execCalls: GuardExecInput[] = [];
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const redeliveryPipeline = createGuardGatePipeline({ clone, checkout }); // default loadCorpus
    const { deps, calls } = makeDeps(async (input) => {
      execCalls.push(input);
      return okReport(latestOf([result('s1', 'fail')], input.commit ?? ''));
    });

    const decision = await redeliveryPipeline.run(deps, payload());

    expect(execCalls.map((c) => c.commit)).toEqual([HEAD_SHA]);
    expect(decision.conclusion).toBe('failure');
    expect(calls.check[0].conclusion).toBe('failure');
  });

  it('a same-corpus redelivery still takes the fast path (no re-run)', async () => {
    await seedCommittedCorpus();
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));

    // Leg 1 — a normal gate run over the committed corpus persists the head run.
    {
      const { clone } = fakeClone();
      const { checkout } = fakeCheckout();
      const pipeline = createGuardGatePipeline({ clone, checkout });
      const { deps } = makeDeps(async (input) =>
        okReport(latestOf([result('s1', 'fail')], input.commit ?? '')),
      );
      await pipeline.run(deps, payload());
    }

    // Leg 2 — a redelivery with the corpus unchanged: decided from the stored
    // run, nothing cloned, nothing executed.
    let cloned = 0;
    const redeliveryPipeline = createGuardGatePipeline({
      clone: async () => {
        cloned++;
        return { baseSha: BASE_SHA, headSha: HEAD_SHA };
      },
      checkout: async () => {},
    });
    const { deps, calls } = makeDeps(neverExecute);

    const decision = await redeliveryPipeline.run(deps, payload());

    expect(cloned).toBe(0);
    expect(decision.conclusion).toBe('failure');
    expect(calls.check[0].conclusion).toBe('failure');
  });
});

describe('guard-gate pipeline — records a GateRunRecord (the refForTabs feed)', () => {
  it('records the settled verdict as a gate run (PR↔headSha mapping for the dashboard)', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps } = makeDeps(async (input) =>
      okReport(latestOf([result('s1', 'fail')], input.commit ?? '')),
    );

    await pipeline.run(deps, payload());

    const runs = await gateStore.listRuns(REPO);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      repoFullName: REPO,
      prNumber: 7,
      headSha: HEAD_SHA,
      baseSha: BASE_SHA,
      conclusion: 'failure',
      addedCount: 1,
      resolvedCount: 0,
    });
  });

  it("maps the internal 'error' conclusion to a 'failure' run record", async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps } = makeDeps(async () => ({
      status: 'run-timed-out',
      elapsedMs: 900_001,
      settled: 0,
      total: 1,
    }));

    await pipeline.run(deps, payload());

    const runs = await gateStore.listRuns(REPO);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.conclusion).toBe('failure');
  });

  it('records the redelivery fast-path verdict too', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    await guardStore.writeGuardRun(REPO, latestOf([result('s1', 'fail')], HEAD_SHA));
    const pipeline = createGuardGatePipeline({
      clone: async () => ({ baseSha: BASE_SHA, headSha: HEAD_SHA }),
      loadCorpus: corpus([scenario('s1')]),
      checkout: async () => {},
    });
    const { deps } = makeDeps(neverExecute);

    await pipeline.run(deps, payload());

    const runs = await gateStore.listRuns(REPO);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ headSha: HEAD_SHA, conclusion: 'failure' });
  });

  it('a recordRun failure never fails the gate (best-effort)', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps, calls } = makeDeps(async (input) =>
      okReport(latestOf([result('s1', 'pass')], input.commit ?? '')),
    );
    deps.store.recordRun = async () => {
      throw new Error('db down');
    };

    const decision = await pipeline.run(deps, payload());

    expect(decision.conclusion).toBe('success');
    expect(calls.check[0].conclusion).toBe('success');
  });

  it('does not record on the kill-switch neutral (guard globally disabled)', async () => {
    process.env[KILL_SWITCH] = '1';
    const { clone } = fakeClone();
    const { checkout } = fakeCheckout();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout });
    const { deps } = makeDeps(neverExecute);

    await pipeline.run(deps, payload());

    expect(await gateStore.listRuns(REPO)).toHaveLength(0);
  });
});

describe('guard-gate pipeline — executor concurrency limiter', () => {
  it('caps concurrent executor runs at the shared permit count', async () => {
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const limiter = createSemaphore(1);
    let inFlight = 0;
    let maxInFlight = 0;
    const execute: GuardExecutor = async (input) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return okReport(latestOf([result('s1', 'pass')], input.commit ?? ''));
    };
    const runFor = (headSha: string) => {
      const { clone } = fakeClone();
      const { checkout } = fakeCheckout();
      const { octokit } = makeOctokit();
      const deps: GuardGatePipelineDeps = {
        store: gateStore,
        guardStore,
        auth: {} as GithubAuth,
        octokitFor: () => octokit,
        execute,
        limiter,
      };
      return createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout }).run(
        deps,
        payload({ headSha, checkRunId: null }),
      );
    };

    await Promise.all([runFor('head-aaaa1'), runFor('head-bbbb2')]);

    expect(maxInFlight).toBe(1);
  });
});
