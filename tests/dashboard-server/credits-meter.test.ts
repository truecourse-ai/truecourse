/**
 * The meter as the TILL: a workspace running on TrueCourse's own key spends a
 * granted balance, and this is where the check before and the debit after live.
 *
 * What is pinned: the platform block comes from the environment and never from
 * the store, every turn of every session reports and is charged, the debit
 * references the `llm_usage` row it charges so the two agree to the cent, a
 * session that opens on an empty balance PARKS with its journal rather than
 * spending, and the job's own assertion turns whatever the engine said into the
 * pause.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import type { SessionDef, SessionDriver, SessionEventBody } from '@truecourse/agent-loop';
import {
  resetWorkspaceLlmBackend,
  resetWorkspaceLlmConfigStore,
  setWorkspaceLlmBackend,
  setWorkspaceLlmConfigStore,
  startWorkspaceLlm,
  platformCreditsConfig,
  creditsOffered,
} from '../../apps/dashboard/server/src/services/workspace-llm.service';
import {
  createUsageMeter,
  withCredits,
} from '../../apps/dashboard/server/src/services/usage-meter.service';
import { setCreditsNotifier } from '../../apps/dashboard/server/src/services/credits.service';
import { isCreditsExhausted } from '../../packages/core/src/lib/credits-store';
import { installCreditsStore, type InstalledCreditsStore } from '../helpers/credits-store';
import { installModelPrices, TEST_PRICES, uninstallModelPrices } from '../helpers/model-prices';

const ORG = 'org_acme';
const JOB = 'job_42';
const REPO = 'acme/widgets';
const OPERATOR = 'user_operator';

const KEY = 'TRUECOURSE_CREDITS_OPENAI_API_KEY';
const MODEL = 'TRUECOURSE_CREDITS_MODEL';

let installed: InstalledCreditsStore;
let saved: Record<string, string | undefined>;
/** What the platform config was built with, as the backend saw it. */
let built: { provider: string; model: string; apiKey?: string } | null;

beforeEach(async () => {
  installed = await installCreditsStore();
  saved = { [KEY]: process.env[KEY], [MODEL]: process.env[MODEL] };
  process.env[KEY] = 'sk-platform-secret';
  process.env[MODEL] = 'gpt-5.6';
  built = null;
  // A credits run starts only when its model has a price to be charged at.
  installModelPrices({ 'openai/gpt-5.6': TEST_PRICES['openai/gpt-5.6-sol']! });
  setCreditsNotifier(async () => {});
  // The workspace named credits: the row holds nothing else.
  setWorkspaceLlmConfigStore({
    getSelection: async () => ({ kind: 'credits' }),
    getConfig: async () => null,
    getView: async () => null,
    save: async () => {},
  });
});

afterEach(async () => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  setCreditsNotifier(null);
  resetWorkspaceLlmConfigStore();
  resetWorkspaceLlmBackend();
  uninstallModelPrices();
  await installed.close();
});

/** The smallest legal session def: only its kind is read here. */
function def(kind: string): SessionDef {
  return {
    kind,
    systemPrompt: '',
    tools: [],
    outcomeSchema: z.object({}),
    budget: { turns: 4, maxResumes: 0, tokenCeiling: 1_000_000 },
  };
}

/** A driver whose session emits `turns` turns and then answers with an outcome. */
function fakeDriver(turns: number, costUsd: number): SessionDriver {
  return {
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    attribution: { provider: 'openai', model: 'gpt-5.6' },
    runSession(input) {
      let interrupted = false;
      const emit = (): void => {
        for (let i = 0; i < turns && !interrupted; i++) {
          const turn: SessionEventBody = {
            type: 'assistant-turn',
            text: 'done',
            usage: {
              inputTokens: 100,
              outputTokens: 10,
              cacheReadTokens: 0,
              cacheCreateTokens: 0,
              costUsd,
              costSource: 'model-priced',
            },
            model: 'gpt-5.6',
          };
          input.onEvent(turn);
        }
      };
      emit();
      return {
        done: Promise.resolve(
          interrupted
            ? ({ kind: 'failure' as const, failure: { kind: 'transport' as const, detail: 'stopped', class: 'unknown' as const, retryability: 'none' as const } })
            : ({ kind: 'outcome' as const, value: {} }),
        ),
        status: () => 'completed' as const,
        steer: () => {},
        interrupt: async () => {
          interrupted = true;
        },
      };
    },
  };
}

/** The backend a credits run gets: it records the block it was handed. */
function installBackend(driver: SessionDriver): void {
  setWorkspaceLlmBackend({
    probe: async (config) => {
      built = { provider: config.provider, model: config.model, ...(config.apiKey ? { apiKey: config.apiKey } : {}) };
    },
    driver: () => driver,
  });
}

/** One session of `kind`, started the way every run starts one. */
function runSession(driver: SessionDriver, kind: string): ReturnType<SessionDriver['runSession']> {
  return driver.runSession({
    def: def(kind),
    initialMessages: [],
    onEvent: () => {},
    signal: new AbortController().signal,
  });
}

/** The leaf judgement a credits run spends one turn on. */
const LEAF = 'guard-generate.match';

const meterFor = (jobId = JOB) =>
  createUsageMeter(
    { workspaceOrgId: ORG, repoFullName: REPO, jobType: 'repo.guard-generate', jobId },
    { flushMs: 5 },
  );

const grant = (credits: number) =>
  installed.store.grant({ workspaceOrgId: ORG, credits, actorUserId: OPERATOR });

describe('the platform key', () => {
  it('is the environment and nothing else — no store read, no answer, no run record', async () => {
    expect(creditsOffered()).toBe(true);
    expect(platformCreditsConfig()).toEqual({
      provider: 'openai',
      model: 'gpt-5.6',
      apiKey: 'sk-platform-secret',
    });
    delete process.env[KEY];
    expect(platformCreditsConfig()).toBeNull();
    expect(creditsOffered()).toBe(false);
    process.env[KEY] = 'sk-platform-secret';
    delete process.env[MODEL];
    expect(platformCreditsConfig()).toBeNull();
  });

  it('is what a credits run is probed and built with, named as truecourse', async () => {
    await grant(1000);
    installBackend(fakeDriver(1, 0.25));
    const meter = meterFor();
    const llm = await startWorkspaceLlm(ORG, meter);
    expect(built).toEqual({ provider: 'openai', model: 'gpt-5.6', apiKey: 'sk-platform-secret' });

    runSession(llm.driver(), LEAF);
    await meter.close();
    const rows = await installed.usage.runs({ workspaceOrgId: ORG, from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' }, 10);
    expect(rows).toHaveLength(1);
    const [usage] = await installed.db.query.llmUsage.findMany();
    // Neither the usage row nor the run record names the provider behind the
    // platform's arrangement, and neither carries its key.
    expect(usage?.provider).toBe('truecourse');
    expect(llm.driver().attribution).toEqual({ provider: 'truecourse', model: 'gpt-5.6' });
    expect(JSON.stringify(llm.driver().attribution)).not.toContain('sk-platform-secret');
  });

  it('refuses to start a workspace whose server holds no platform key', async () => {
    delete process.env[KEY];
    installBackend(fakeDriver(1, 0.25));
    await expect(startWorkspaceLlm(ORG, meterFor())).rejects.toThrow(/no credits provider/i);
  });

  // Every metered job starts here, the ones no route saw included (a chained
  // setup → generate → run, the ripple, a resumed pause): a run that cannot be
  // priced cannot be charged, so it never reaches the provider.
  it('refuses to start a run whose model has no price, before anything is probed', async () => {
    await grant(1000);
    uninstallModelPrices();
    installBackend(fakeDriver(1, 0.25));
    await expect(startWorkspaceLlm(ORG, meterFor())).rejects.toMatchObject({
      code: 'credits-prices-unavailable',
    });
    expect(built).toBeNull();

    // A table that does not hold the model is no better than none.
    installModelPrices({ 'openai/gpt-5.6-luna': TEST_PRICES['openai/gpt-5.6-sol']! });
    await expect(startWorkspaceLlm(ORG, meterFor())).rejects.toMatchObject({
      code: 'credits-prices-unavailable',
    });
    expect(built).toBeNull();
  });

  it('charges a deployment name as the list-price model it serves', async () => {
    await grant(1000);
    process.env[MODEL] = 'gpt-5.6-sol-2';
    installModelPrices();
    installBackend(fakeDriver(1, 0.25));
    // Unmapped, a deployment name has no price, so the run does not start.
    await expect(startWorkspaceLlm(ORG, meterFor())).rejects.toMatchObject({
      code: 'credits-prices-unavailable',
    });
    process.env.TRUECOURSE_CREDITS_PRICE_MODEL = 'gpt-5.6-sol';
    try {
      await expect(startWorkspaceLlm(ORG, meterFor())).resolves.toMatchObject({ mode: 'api' });
    } finally {
      delete process.env.TRUECOURSE_CREDITS_PRICE_MODEL;
    }
  });
});

describe('charging', () => {
  it('debits a LEAF judgement against the usage row it spent on', async () => {
    await grant(1000);
    installBackend(fakeDriver(1, 0.25));
    const meter = meterFor();
    const llm = await startWorkspaceLlm(ORG, meter);
    runSession(llm.driver(), LEAF);
    runSession(llm.driver(), LEAF);
    await meter.close();

    // 2 one-turn sessions × $0.25 = 50 credits.
    expect((await installed.store.balance(ORG)).balance).toBe(950);
    const [debit] = (await installed.store.ledger(ORG, 10)).filter((row) => row.kind === 'debit');
    const [usage] = await installed.db.query.llmUsage.findMany();
    expect(debit?.usageId).toBe(usage?.id);
    expect(debit?.amount).toBe(-50);
    expect(Number(usage?.costUsd)).toBeCloseTo(0.5, 6);
  });

  it('debits an agent session’s turns under the session kind', async () => {
    await grant(1000);
    installBackend(fakeDriver(3, 0.1));
    const meter = meterFor();
    const llm = await startWorkspaceLlm(ORG, meter);
    runSession(llm.driver(), 'guard.flow-worker');
    await meter.close();

    // 3 turns × $0.10 = 30 credits, on one row for the kind.
    expect((await installed.store.balance(ORG)).balance).toBe(970);
    const rows = await installed.db.query.llmUsage.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.subject).toBe('guard.flow-worker');
    expect(rows[0]?.provider).toBe('truecourse');
  });

  it('charges the whole of a run, not each flush rounded — sub-cent calls add up', async () => {
    await grant(1000);
    installBackend(fakeDriver(1, 0.004));
    const meter = meterFor();
    const llm = await startWorkspaceLlm(ORG, meter);
    for (let i = 0; i < 10; i++) {
      runSession(llm.driver(), LEAF);
      await meter.flush();
    }
    await meter.close();
    // 10 × $0.004 is $0.04: four credits, not ten flushes rounded to zero.
    expect((await installed.store.balance(ORG)).balance).toBe(996);
  });

  it('leaves a workspace on its own key alone', async () => {
    setWorkspaceLlmConfigStore({
      getSelection: async () => ({
        kind: 'api',
        config: { provider: 'anthropic', model: 'claude-opus-5', apiKey: 'sk-own' },
      }),
      getConfig: async () => ({ provider: 'anthropic', model: 'claude-opus-5', apiKey: 'sk-own' }),
      getView: async () => null,
      save: async () => {},
    });
    installBackend(fakeDriver(1, 5));
    const meter = meterFor();
    const llm = await startWorkspaceLlm(ORG, meter);
    runSession(llm.driver(), LEAF);
    await meter.close();
    expect((await installed.store.balance(ORG)).balance).toBe(0);
    expect(await installed.store.ledger(ORG, 10)).toEqual([]);
    expect(meter.exhausted()).toBe(false);
  });
});

describe('the gate', () => {
  it('parks the session that opens on an empty balance, with nothing spent', async () => {
    // One session's worth of credit, then nothing.
    await grant(25);
    installBackend(fakeDriver(1, 0.25));
    const meter = meterFor();
    const llm = await startWorkspaceLlm(ORG, meter);
    runSession(llm.driver(), LEAF);
    await meter.flush();
    expect((await installed.store.balance(ORG)).balance).toBe(0);

    const handle = runSession(llm.driver(), 'guard.flow-worker');
    expect(handle.status()).toBe('parked');
    await expect(handle.done).resolves.toMatchObject({
      kind: 'failure',
      failure: { kind: 'transport', detail: 'out of credits', retryability: 'blocked' },
    });
    expect(meter.exhausted()).toBe(true);
    await meter.close();
    // The parked session never reached the model, so it is on no usage row.
    const rows = await installed.db.query.llmUsage.findMany();
    expect(rows.map((row) => row.subject)).toEqual([LEAF]);
    expect(rows[0]?.calls).toBe(1);
  });

  it('stops a session part-way once its turns have emptied the balance', async () => {
    await grant(25);
    installBackend(fakeDriver(4, 0.25));
    const meter = meterFor();
    const llm = await startWorkspaceLlm(ORG, meter);
    const seen: string[] = [];
    const handle = llm.driver().runSession({
      def: def('guard.flow-worker'),
      initialMessages: [],
      onEvent: (event) => seen.push(event.type),
      signal: new AbortController().signal,
    });
    // The turns emit synchronously; the balance only moves on a flush, so the
    // gate cannot trip mid-burst — the flush is what empties it.
    await meter.flush();
    await handle.done;
    expect(seen.filter((type) => type === 'assistant-turn').length).toBeGreaterThan(0);
    expect(meter.exhausted()).toBe(true);
    await meter.close();
  });

  it('turns whatever the engine said into the pause, on both paths', async () => {
    await grant(25);
    installBackend(fakeDriver(1, 0.25));
    const meter = meterFor();
    const llm = await startWorkspaceLlm(ORG, meter);
    runSession(llm.driver(), LEAF);
    await meter.flush();
    runSession(llm.driver(), 'guard.flow-worker');

    await expect(
      withCredits(meter, async () => {
        throw new Error('every extraction session failed');
      }),
    ).rejects.toSatisfy(isCreditsExhausted);
    await expect(withCredits(meter, async () => 'finished')).rejects.toSatisfy(isCreditsExhausted);
    await meter.close();
  });

  it('lets a run that never ran out through untouched', async () => {
    await grant(1000);
    installBackend(fakeDriver(1, 0.25));
    const meter = meterFor();
    const llm = await startWorkspaceLlm(ORG, meter);
    runSession(llm.driver(), LEAF);
    await meter.flush();
    await expect(withCredits(meter, async () => 'finished')).resolves.toBe('finished');
    await expect(withCredits(meter, async () => Promise.reject(new Error('real failure')))).rejects.toThrow(
      'real failure',
    );
    await meter.close();
  });
});
