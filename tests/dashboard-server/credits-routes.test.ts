/**
 * The credits surfaces, as addresses.
 *
 * `/api/credits` is every member's: a balance is not a secret from the people
 * spending it. `/api/operator/credits` is TrueCourse staff only, and a member
 * who reaches it is told there is NO SUCH ROUTE rather than that they may not
 * have it. Neither is there at all in local mode.
 *
 * The grant is also the resume: a workspace that can spend again carries on
 * what it stopped, in the order it stopped it, unless the operator says not to.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

vi.mock('../../apps/dashboard/server/src/socket/handlers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../apps/dashboard/server/src/socket/handlers')>();
  return {
    ...actual,
    emitSpecProgress: vi.fn(),
    emitSpecComplete: vi.fn(),
    createSocketSpecTracker: () => ({ start() {}, done() {}, error() {}, detail() {} }),
  };
});

import type { AuthVerifier, CreditsResponse, OperatorCreditsResponse } from '@truecourse/shared';
import type { PausedJob } from '@truecourse/data-store';
import { createTestApp, resetTestWorkspaceLlm, stubJobs, TEST_ORG } from '../helpers/test-app';
import { clearTestRegistry } from '../helpers/test-fixture';
import { installCreditsStore, type InstalledCreditsStore } from '../helpers/credits-store';
import { installModelPrices, TEST_PRICES, uninstallModelPrices } from '../helpers/model-prices';
import {
  platformCreditsConfig,
  resetWorkspaceLlmConfigStore,
  setWorkspaceLlmConfigStore,
} from '../../apps/dashboard/server/src/services/workspace-llm.service';
import {
  creditsStartCheck,
  setCreditsNotifier,
} from '../../apps/dashboard/server/src/services/credits.service';

const OPERATOR = 'user_operator';

let installed: InstalledCreditsStore;
/** What the stub queue was asked to carry on, in order. */
let resumed: PausedJob[];
/** What it says is paused. */
let paused: PausedJob[];
/** Whether the workspace named credits rather than a key of its own. */
let credits: boolean;

/** A session that is (or is not) TrueCourse staff. */
const asOperator: AuthVerifier = async () => ({
  user: { id: OPERATOR, email: 'ops@truecourse.dev', organizationId: TEST_ORG, isOperator: true },
});

function pausedJob(over: Partial<PausedJob> = {}): PausedJob {
  return {
    id: 'job_paused',
    workspaceOrgId: TEST_ORG,
    type: 'repo.guard-generate',
    key: 'repo.guard-generate:acme/api',
    payload: { repoFullName: 'acme/api', carryOnRunId: 'run_9' },
    reason: 'credits',
    pausedAt: '2026-03-01T10:00:00.000Z',
    ...over,
  };
}

/** The app, with a queue that reports what it was asked to resume. */
function appWith(overrides: Parameters<typeof createTestApp>[0] = {}): Express {
  const jobs = Object.assign(stubJobs().mount, {
    jobStore: {
      listPaused: async (org: string) => (org === TEST_ORG ? paused : []),
      pausedCounts: async (orgs: readonly string[]) =>
        new Map(orgs.map((org) => [org, org === TEST_ORG ? paused.length : 0])),
    },
    // The real one revives the paused row, so it answers that row's own id and
    // the row is no longer waiting.
    resumePaused: async (job: PausedJob) => {
      resumed.push(job);
      paused = paused.filter((row) => row.id !== job.id);
      return job.id;
    },
  });
  const app = createTestApp({ jobs: jobs as never, ...overrides });
  // `createTestApp` installs its own provider store; this workspace's choice is
  // the one under test, so it goes in after.
  onCredits(credits);
  return app;
}

/** A workspace that named credits rather than a key of its own. */
function onCredits(yes: boolean): void {
  setWorkspaceLlmConfigStore({
    getSelection: async () =>
      yes
        ? { kind: 'credits' }
        : { kind: 'api', config: { provider: 'anthropic', model: 'claude-opus-5', apiKey: 'sk' } },
    getConfig: async () =>
      yes ? null : { provider: 'anthropic', model: 'claude-opus-5', apiKey: 'sk' },
    getView: async () => null,
    save: async () => {},
  });
}

beforeEach(async () => {
  installed = await installCreditsStore();
  resumed = [];
  paused = [];
  credits = true;
  setCreditsNotifier(async () => {});
});

afterEach(async () => {
  setCreditsNotifier(null);
  resetWorkspaceLlmConfigStore();
  resetTestWorkspaceLlm();
  clearTestRegistry();
  await installed.close();
});

describe('GET /api/credits', () => {
  it('answers a workspace that has never been granted anything', async () => {
    const res = await request(appWith()).get('/api/credits').expect(200);
    const body = res.body as CreditsResponse;
    expect(body).toMatchObject({
      balance: 0,
      lastGrantCredits: 0,
      lastGrantAt: null,
      entries: [],
      pausedRuns: [],
      onCredits: true,
    });
  });

  it('answers the balance, the statement and what is paused', async () => {
    await installed.store.grant({
      workspaceOrgId: TEST_ORG,
      credits: 5000,
      actorUserId: OPERATOR,
      note: 'launch',
    });
    const usageId = await installed.usage.record({
      workspaceOrgId: TEST_ORG,
      repoFullName: 'acme/api',
      jobType: 'repo.guard-generate',
      jobId: 'job_1',
      runId: 'run_1',
      subjectKind: 'session',
      subject: 'guard.flow-worker',
      provider: 'truecourse',
      model: 'gpt-5.6',
      inputTokens: 10,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreateTokens: 0,
      calls: 1,
      costUsd: 1.2,
      inputCostUsd: 0.2,
      outputCostUsd: 1,
      cachedCostUsd: 0,
      startedAt: '2026-03-01T10:00:00.000Z',
      finishedAt: '2026-03-01T10:00:00.000Z',
    });
    await installed.store.charge({ workspaceOrgId: TEST_ORG, credits: 120, usageId });
    paused = [pausedJob()];

    const body = (await request(appWith()).get('/api/credits').expect(200)).body as CreditsResponse;
    expect(body.balance).toBe(4880);
    expect(body.lastGrantCredits).toBe(5000);
    expect(body.entries.map((row) => [row.kind, row.amount])).toEqual([
      ['debit', -120],
      ['grant', 5000],
    ]);
    // The debit line is the RUN, named in the product's words and opening it.
    expect(body.entries[0]).toMatchObject({
      title: 'Flow generation',
      runId: 'run_1',
      repository: 'acme/api',
      balanceAfter: 4880,
    });
    expect(body.entries[1]).toMatchObject({ note: 'launch', actorUserId: OPERATOR });
    expect(body.pausedRuns).toEqual([
      {
        jobId: 'job_paused',
        jobType: 'repo.guard-generate',
        title: 'Flow generation',
        repository: 'acme/api',
        runId: 'run_9',
        pausedAt: '2026-03-01T10:00:00.000Z',
      },
    ]);
  });

  it('says a workspace on its own key is not spending credits', async () => {
    credits = false;
    const body = (await request(appWith()).get('/api/credits').expect(200)).body as CreditsResponse;
    expect(body.onCredits).toBe(false);
  });
});

describe('POST /api/credits/resume/:jobId', () => {
  it('carries one paused run on once the workspace can spend', async () => {
    await installed.store.grant({ workspaceOrgId: TEST_ORG, credits: 100, actorUserId: OPERATOR });
    paused = [pausedJob()];
    const res = await request(appWith()).post('/api/credits/resume/job_paused').expect(202);
    expect(res.body).toEqual({ jobId: 'job_paused' });
    expect(resumed.map((job) => job.id)).toEqual(['job_paused']);
  });

  it('refuses while the balance is empty — it would only pause again', async () => {
    paused = [pausedJob()];
    await request(appWith()).post('/api/credits/resume/job_paused').expect(409);
    expect(resumed).toEqual([]);
  });

  it('answers not found for a job this workspace has not paused', async () => {
    await installed.store.grant({ workspaceOrgId: TEST_ORG, credits: 100, actorUserId: OPERATOR });
    await request(appWith()).post('/api/credits/resume/job_elsewhere').expect(404);
  });
});

describe('the operator’s credits', () => {
  it('is not a route at all for a member', async () => {
    await request(appWith()).get('/api/operator/credits').expect(404);
    await request(appWith())
      .post('/api/operator/credits/grant')
      .send({ workspaceOrgId: TEST_ORG, credits: 10 })
      .expect(404);
    await request(appWith())
      .post('/api/operator/credits/adjust')
      .send({ workspaceOrgId: TEST_ORG, credits: 10 })
      .expect(404);
  });

  it('lists every workspace with its balance, its spend and what it stopped', async () => {
    await installed.store.grant({ workspaceOrgId: TEST_ORG, credits: 900, actorUserId: OPERATOR });
    const app = appWith({ authVerifier: asOperator });
    paused = [pausedJob(), pausedJob({ id: 'job_paused_2', key: 'k2' })];
    const body = (await request(app).get('/api/operator/credits').expect(200))
      .body as OperatorCreditsResponse;
    expect(body.workspaces).toEqual([
      {
        workspaceOrgId: TEST_ORG,
        // No identity provider to ask on this server, so the page has an id.
        workspaceName: null,
        balance: 900,
        lastGrantCredits: 900,
        lastGrantAt: expect.any(String),
        spent30d: 0,
        pausedRuns: 2,
      },
    ]);
  });

  it('names each workspace the way the identity provider does', async () => {
    await installed.store.grant({ workspaceOrgId: TEST_ORG, credits: 900, actorUserId: OPERATOR });
    const asked: string[] = [];
    const app = appWith({
      authVerifier: asOperator,
      workspaceNames: async (organizationId: string) => {
        asked.push(organizationId);
        return 'Acme Inc.';
      },
    });
    const body = (await request(app).get('/api/operator/credits').expect(200))
      .body as OperatorCreditsResponse;
    expect(asked).toEqual([TEST_ORG]);
    expect(body.workspaces[0]).toMatchObject({
      workspaceOrgId: TEST_ORG,
      workspaceName: 'Acme Inc.',
      balance: 900,
    });
  });

  it('still answers when the name cannot be looked up, and the row keeps its id', async () => {
    await installed.store.grant({ workspaceOrgId: TEST_ORG, credits: 900, actorUserId: OPERATOR });
    const app = appWith({
      authVerifier: asOperator,
      workspaceNames: async () => {
        throw new Error('WorkOS refused');
      },
    });
    const body = (await request(app).get('/api/operator/credits').expect(200))
      .body as OperatorCreditsResponse;
    expect(body.workspaces[0]).toMatchObject({
      workspaceOrgId: TEST_ORG,
      workspaceName: null,
      balance: 900,
    });
  });

  it('grants, and carries on what the workspace had paused, oldest first', async () => {
    const app = appWith({ authVerifier: asOperator });
    paused = [
      pausedJob({ id: 'job_first', pausedAt: '2026-03-01T09:00:00.000Z' }),
      pausedJob({ id: 'job_second', key: 'k2', pausedAt: '2026-03-01T10:00:00.000Z' }),
    ];
    const res = await request(app)
      .post('/api/operator/credits/grant')
      .send({ workspaceOrgId: TEST_ORG, credits: 2500, note: 'pilot' })
      .expect(200);
    expect(res.body).toEqual({ balance: 2500, resumed: 2 });
    expect(resumed.map((job) => job.id)).toEqual(['job_first', 'job_second']);
    expect((await installed.store.ledger(TEST_ORG, 10))[0]).toMatchObject({
      kind: 'grant',
      amount: 2500,
      actorUserId: OPERATOR,
      note: 'pilot',
    });
  });

  it('leaves them paused when the operator unticks it', async () => {
    const app = appWith({ authVerifier: asOperator });
    paused = [pausedJob()];
    const res = await request(app)
      .post('/api/operator/credits/grant')
      .send({ workspaceOrgId: TEST_ORG, credits: 100, resumePaused: false })
      .expect(200);
    expect(res.body).toEqual({ balance: 100, resumed: 0 });
    expect(resumed).toEqual([]);
  });

  it('adjusts either way, and starts nothing', async () => {
    const app = appWith({ authVerifier: asOperator });
    await installed.store.grant({ workspaceOrgId: TEST_ORG, credits: 500, actorUserId: OPERATOR });
    paused = [pausedJob()];
    const res = await request(app)
      .post('/api/operator/credits/adjust')
      .send({ workspaceOrgId: TEST_ORG, credits: -200, note: 'double charged' })
      .expect(200);
    expect(res.body).toEqual({ balance: 300, resumed: 0 });
    expect(resumed).toEqual([]);
  });

  it('refuses a grant that is not one, and an adjustment of nothing', async () => {
    const app = appWith({ authVerifier: asOperator });
    await request(app)
      .post('/api/operator/credits/grant')
      .send({ workspaceOrgId: TEST_ORG, credits: -10 })
      .expect(400);
    await request(app)
      .post('/api/operator/credits/adjust')
      .send({ workspaceOrgId: TEST_ORG, credits: 0 })
      .expect(400);
    await request(app).post('/api/operator/credits/grant').send({ credits: 10 }).expect(400);
  });
});

describe('local mode', () => {
  const saved = process.env.TRUECOURSE_MODE;

  afterEach(() => {
    if (saved === undefined) delete process.env.TRUECOURSE_MODE;
    else process.env.TRUECOURSE_MODE = saved;
  });

  it('has no credits at all — the tab, the routes and the operator page are absent', async () => {
    process.env.TRUECOURSE_MODE = 'local';
    const app = appWith({ authVerifier: asOperator });
    await request(app).get('/api/credits').expect(404);
    await request(app).get('/api/operator/credits').expect(404);
    await request(app)
      .post('/api/operator/credits/grant')
      .send({ workspaceOrgId: TEST_ORG, credits: 10 })
      .expect(404);
  });
});

describe('the start gate', () => {
  const CREDITS_ENV = [
    'TRUECOURSE_CREDITS_OPENAI_API_KEY',
    'TRUECOURSE_CREDITS_MODEL',
    'TRUECOURSE_CREDITS_OPENAI_BASE_URL',
    'TRUECOURSE_CREDITS_PRICE_MODEL',
  ] as const;
  const saved = Object.fromEntries(CREDITS_ENV.map((name) => [name, process.env[name]]));

  beforeEach(() => {
    process.env.TRUECOURSE_CREDITS_OPENAI_API_KEY = 'sk-platform';
    process.env.TRUECOURSE_CREDITS_MODEL = 'gpt-5.6';
    delete process.env.TRUECOURSE_CREDITS_OPENAI_BASE_URL;
    delete process.env.TRUECOURSE_CREDITS_PRICE_MODEL;
    installModelPrices({ 'openai/gpt-5.6': TEST_PRICES['openai/gpt-5.6-sol']! });
  });

  afterEach(() => {
    uninstallModelPrices();
    for (const name of CREDITS_ENV) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('refuses a scan at zero, and lets it through with a balance', async () => {
    const refused = await request(appWith()).post('/api/context/scan').expect(409);
    expect(refused.body).toMatchObject({ error: 'credits-exhausted' });
    expect(refused.body.credits).toMatchObject({ verdict: 'refused', balance: 0 });

    await installed.store.grant({ workspaceOrgId: TEST_ORG, credits: 100, actorUserId: OPERATOR });
    await request(appWith()).post('/api/context/scan').expect(202);
  });

  it('leaves a workspace on its own key alone', async () => {
    credits = false;
    await request(appWith()).post('/api/context/scan').expect(202);
  });

  it('asks before starting a run the balance may not cover, and takes the answer', async () => {
    await installed.store.grant({ workspaceOrgId: TEST_ORG, credits: 100, actorUserId: OPERATOR });
    // 300 credits' worth against a balance of 100: worth starting or not, but
    // only the person paying can say.
    const priceModel = 'gpt-5.6';
    expect(await creditsStartCheck(TEST_ORG, { priceModel, estimateUsd: 3 })).toMatchObject({
      verdict: 'confirm',
      balance: 100,
      estimate: 300,
    });
    expect(await creditsStartCheck(TEST_ORG, { priceModel, estimateUsd: 0.5 })).toMatchObject({
      verdict: 'ok',
      estimate: 50,
    });
    // With no estimate to compare, a balance above zero is a start.
    expect(await creditsStartCheck(TEST_ORG, { priceModel })).toMatchObject({ verdict: 'ok' });
  });

  it('refuses a credits run whose model cannot be priced, and says prices are not there yet', async () => {
    await installed.store.grant({ workspaceOrgId: TEST_ORG, credits: 100, actorUserId: OPERATOR });
    uninstallModelPrices();
    const refused = await request(appWith()).post('/api/context/scan').expect(503);
    expect(refused.body).toMatchObject({
      error: 'credits-prices-unavailable',
      message: expect.stringMatching(/prices are not available yet/i),
    });
    expect(refused.body.credits).toMatchObject({
      verdict: 'refused',
      reason: 'prices-unavailable',
      balance: 100,
    });
    // The same for a start that goes through the repository routes' gate.
    expect(await creditsStartCheck(TEST_ORG, { priceModel: 'gpt-5.6' })).toMatchObject({
      verdict: 'refused',
      reason: 'prices-unavailable',
    });
    // A table that holds no price for the model is no table for this run.
    installModelPrices({ 'openai/gpt-5.6-luna': TEST_PRICES['openai/gpt-5.6-sol']! });
    await request(appWith()).post('/api/context/scan').expect(503);
    installModelPrices({ 'openai/gpt-5.6': TEST_PRICES['openai/gpt-5.6-sol']! });
    await request(appWith()).post('/api/context/scan').expect(202);
  });

  it('leaves a paused run paused while its model cannot be priced', async () => {
    await installed.store.grant({ workspaceOrgId: TEST_ORG, credits: 100, actorUserId: OPERATOR });
    uninstallModelPrices();
    paused = [pausedJob()];
    const res = await request(appWith()).post('/api/credits/resume/job_paused').expect(503);
    expect(res.body).toMatchObject({ error: 'credits-prices-unavailable' });
    expect(resumed).toEqual([]);
  });

  it('starts a workspace on its own key with no prices at all', async () => {
    credits = false;
    uninstallModelPrices();
    await request(appWith()).post('/api/context/scan').expect(202);
  });

  it('runs the platform key against its own endpoint, priced as the model the deployment serves', () => {
    process.env.TRUECOURSE_CREDITS_OPENAI_BASE_URL =
      'https://acme.services.ai.azure.com/openai/v1';
    process.env.TRUECOURSE_CREDITS_MODEL = 'gpt-5.6-sol-2';
    process.env.TRUECOURSE_CREDITS_PRICE_MODEL = 'gpt-5.6-sol';
    expect(platformCreditsConfig()).toEqual({
      provider: 'openai',
      model: 'gpt-5.6-sol-2',
      apiKey: 'sk-platform',
      baseURL: 'https://acme.services.ai.azure.com/openai/v1',
      priceModel: 'gpt-5.6-sol',
    });
  });

  it('carries neither when neither is set', () => {
    expect(platformCreditsConfig()).toEqual({
      provider: 'openai',
      model: 'gpt-5.6',
      apiKey: 'sk-platform',
    });
  });

  it('tells a credits workspace when the server holds no platform key', async () => {
    delete process.env.TRUECOURSE_CREDITS_OPENAI_API_KEY;
    await installed.store.grant({ workspaceOrgId: TEST_ORG, credits: 100, actorUserId: OPERATOR });
    const res = await request(appWith()).post('/api/context/scan').expect(409);
    expect(res.body).toMatchObject({ error: 'credits-provider-unavailable' });
  });
});
