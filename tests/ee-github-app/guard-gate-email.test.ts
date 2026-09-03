/**
 * Guard-gate email send-site: the pipeline fires the gate-failure notification
 * exactly once per run, and ONLY when a blocking PR concludes `failure` with new
 * failing scenarios. Error/neutral/pref-off/empty-recipients all stay silent.
 * Driven through the real pipeline over PGlite stores with a fake notifier.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { schema, MIGRATIONS_DIR, type Db } from '@truecourse/db';
import type {
  GithubNotificationPrefs,
  GuardLatest,
  GuardOutcome,
  GuardScenario,
  GuardScenarioResult,
} from '@truecourse/shared';
import type { GuardExecReport, GuardExecutor, Recipe } from '@truecourse/guard-runner';
import { PgGuardStore } from '../../ee/packages/data-store/src/index';
import { selectGateStore } from '../../ee/packages/github-app/src/store/index';
import type { GateStore, RepoLinkRecord } from '../../packages/github-app/src/store/types';
import type { GithubAuth } from '../../packages/github-app/src/github';
import type {
  EmailNotifier,
  GuardGateFailureEmail,
} from '../../ee/packages/github-app/src/email';
import {
  createGuardGatePipeline,
  type GuardGateClone,
  type GuardGatePipelineDeps,
  type GuardGateRunRequest,
} from '../../ee/packages/github-app/src/guard-gate-runner';

const REPO = 'acme/api';
const BASE_SHA = 'base1234567890';
const HEAD_SHA = 'head1234567890';
const KILL_SWITCH = 'TRUECOURSE_GUARD_GATE_DISABLED';
const RECIPE: Recipe = { build: 'npm run build', entry: ['node', 'cli.js'] };

function scenario(id: string): GuardScenario {
  return {
    guard: 2,
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
      scenarioFormat: 2,
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

function makeOctokit() {
  const calls = { check: [] as any[] };
  const checkRuns = new Map<number, any>();
  let nextCheckId = 1000;
  const octokit: any = {
    checks: {
      create: async (p: any) => {
        const id = ++nextCheckId;
        if (p.status === 'in_progress') checkRuns.set(id, p);
        else calls.check.push(p);
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

const clone: GuardGateClone = async () => ({ baseSha: BASE_SHA, headSha: HEAD_SHA });
const corpus = (scenarios: GuardScenario[]) => async () => ({ recipe: RECIPE, scenarios });

function fakeNotifier() {
  const calls: Array<{ to: string[]; email: GuardGateFailureEmail }> = [];
  const notifier: EmailNotifier = {
    sendGuardGateFailure: async (to, email) => void calls.push({ to, email }),
    sendGuardConflictsBlocked: async () => {},
    sendGuardSpecRegenOffer: async () => {},
  };
  return { notifier, calls };
}

let client: PGlite;
let db: Db;
let guardStore: PgGuardStore;
let gateStore: GateStore;
let savedKillSwitch: string | undefined;

async function link(over: Partial<RepoLinkRecord> = {}): Promise<void> {
  await gateStore.linkRepo({
    repoFullName: REPO,
    installationId: 42,
    workspaceOrgId: 'org_A',
    defaultBranch: 'main',
    blocking: true,
    enabled: true,
    notifyEmails: ['a@x.com', 'b@x.com'],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  });
}

beforeEach(async () => {
  client = new PGlite();
  db = drizzle(client, { schema }) as unknown as Db;
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  guardStore = new PgGuardStore(db);
  gateStore = selectGateStore(db);
  savedKillSwitch = process.env[KILL_SWITCH];
  delete process.env[KILL_SWITCH];
});

afterEach(async () => {
  if (savedKillSwitch === undefined) delete process.env[KILL_SWITCH];
  else process.env[KILL_SWITCH] = savedKillSwitch;
  await client.close();
});

function makeDeps(execute: GuardExecutor, notifier?: EmailNotifier) {
  const { octokit, calls } = makeOctokit();
  const deps: GuardGatePipelineDeps = {
    store: gateStore,
    guardStore,
    auth: {} as GithubAuth,
    octokitFor: () => octokit,
    execute,
    limiter: { run: (fn) => fn() },
    notifier,
  };
  return { deps, calls };
}

/** A run whose head fails a scenario that passed on the stored baseline. */
function failingRun() {
  return async (input: { commit?: string }) =>
    okReport(latestOf([result('s1', 'fail')], input.commit ?? ''));
}

describe('guard-gate email — sends on a blocking failure', () => {
  it('fires once to the repo notify addresses with the newly-failing scenarios', async () => {
    await link();
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const { notifier, calls: sent } = fakeNotifier();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout: async () => {} });
    const { deps, calls } = makeDeps(failingRun(), notifier);

    const decision = await pipeline.run(deps, payload());

    expect(decision.conclusion).toBe('failure');
    expect(calls.check[0].conclusion).toBe('failure');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual(['a@x.com', 'b@x.com']);
    expect(sent[0].email.repoFullName).toBe(REPO);
    expect(sent[0].email.prNumber).toBe(7);
    expect(sent[0].email.prUrl).toBe('https://github.com/acme/api/pull/7');
    expect(sent[0].email.failing.map((s) => s.id)).toEqual(['s1']);
  });

  it('fires once via the redelivery fast path too', async () => {
    await link();
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    await guardStore.writeGuardRun(REPO, latestOf([result('s1', 'fail')], HEAD_SHA));
    const { notifier, calls: sent } = fakeNotifier();
    const pipeline = createGuardGatePipeline({
      clone,
      loadCorpus: corpus([scenario('s1')]),
      checkout: async () => {},
    });
    const { deps } = makeDeps(async () => {
      throw new Error('executor must not run on the redelivery path');
    }, notifier);

    await pipeline.run(deps, payload());

    expect(sent).toHaveLength(1);
    expect(sent[0].email.failing.map((s) => s.id)).toEqual(['s1']);
  });
});

describe('guard-gate email — silent outcomes', () => {
  it('does not send when the gate errors (no verdict)', async () => {
    await link();
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const { notifier, calls: sent } = fakeNotifier();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout: async () => {} });
    const { deps, calls } = makeDeps(
      async () => ({ status: 'run-timed-out', elapsedMs: 900_001, settled: 0, total: 1 }),
      notifier,
    );

    const decision = await pipeline.run(deps, payload());

    // Error renders as a FAILURE Check, but the internal conclusion is 'error'.
    expect(decision.conclusion).toBe('error');
    expect(calls.check[0].conclusion).toBe('failure');
    expect(sent).toHaveLength(0);
  });

  it('does not send on an advisory (non-blocking) neutral even with new failures', async () => {
    await link({ blocking: false });
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const { notifier, calls: sent } = fakeNotifier();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout: async () => {} });
    const { deps, calls } = makeDeps(failingRun(), notifier);

    const decision = await pipeline.run(deps, payload());

    expect(decision.conclusion).toBe('neutral');
    expect(decision.diff.newlyFailing.map((s) => s.id)).toEqual(['s1']);
    expect(calls.check[0].conclusion).toBe('neutral');
    expect(sent).toHaveLength(0);
  });

  it('does not send when the gateFailure pref is off', async () => {
    const notifications: GithubNotificationPrefs = { gateFailure: false, conflicts: true };
    await link({ notifications });
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const { notifier, calls: sent } = fakeNotifier();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout: async () => {} });
    const { deps, calls } = makeDeps(failingRun(), notifier);

    await pipeline.run(deps, payload());

    expect(calls.check[0].conclusion).toBe('failure');
    expect(sent).toHaveLength(0);
  });

  it('does not send when no notify addresses are configured', async () => {
    await link({ notifyEmails: [] });
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const { notifier, calls: sent } = fakeNotifier();
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout: async () => {} });
    const { deps } = makeDeps(failingRun(), notifier);

    await pipeline.run(deps, payload());

    expect(sent).toHaveLength(0);
  });

  it('does not send when no notifier is wired (no Resend key)', async () => {
    await link();
    await guardStore.writeGuardLatest(REPO, latestOf([result('s1', 'pass')], BASE_SHA));
    const pipeline = createGuardGatePipeline({ clone, loadCorpus: corpus([scenario('s1')]), checkout: async () => {} });
    const { deps, calls } = makeDeps(failingRun(), undefined);

    const decision = await pipeline.run(deps, payload());

    expect(decision.conclusion).toBe('failure');
    expect(calls.check[0].conclusion).toBe('failure');
  });
});
