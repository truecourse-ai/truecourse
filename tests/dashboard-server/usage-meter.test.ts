/**
 * The meter a job spends through, end to end into the store.
 *
 * What is pinned: a one-shot call reaches it through the transport the run was
 * built with, an agent session reaches it through the `assistant-turn` events
 * the driver already emits, a pool of sessions of one KIND is ONE row, the row
 * exists before the run ends, the run id names rows written before it opened,
 * and a run that throws has still paid for what it spent.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { SessionDef, SessionDriver, SessionEventBody } from '@truecourse/agent-loop';
import type { LlmTransport } from '@truecourse/shared/llm';
import { z } from 'zod';
import {
  resetWorkspaceLlmBackend,
  resetWorkspaceLlmConfigStore,
  setWorkspaceLlmBackend,
  setWorkspaceLlmConfigStore,
  startWorkspaceLlm,
} from '../../apps/dashboard/server/src/services/workspace-llm.service';
import { createUsageMeter } from '../../apps/dashboard/server/src/services/usage-meter.service';
import { installUsageStore, type InstalledUsageStore } from '../helpers/usage-store';

const ORG = 'org_acme';
const JOB = 'job_42';
const REPO = 'acme/widgets';

const ALL = {
  workspaceOrgId: ORG,
  from: '2000-01-01T00:00:00.000Z',
  to: '2100-01-01T00:00:00.000Z',
};

let installed: InstalledUsageStore;

/** A driver whose sessions emit one turn each and then answer. */
function fakeDriver(): SessionDriver {
  return {
    capabilities: { steering: 'turn-boundary', structuredOutcome: 'tool', resumeAtMessage: false },
    attribution: { provider: 'anthropic', model: 'claude-opus-5' },
    runSession(input) {
      const turn: SessionEventBody = {
        type: 'assistant-turn',
        text: 'done',
        usage: {
          inputTokens: 300,
          outputTokens: 40,
          cacheReadTokens: 1_000,
          cacheCreateTokens: 10,
          costUsd: 0.5,
          costSource: 'model-priced',
        },
        model: 'claude-opus-5-20260101',
      };
      input.onEvent(turn);
      return {
        done: Promise.resolve({ kind: 'outcome' as const, value: {} }),
        status: () => 'completed' as const,
        steer: () => {},
        interrupt: async () => {},
      };
    },
  };
}

/** The smallest legal session def: only its kind is read here. */
function def(kind: string): SessionDef {
  return {
    kind,
    systemPrompt: '',
    tools: [],
    outcomeSchema: z.object({}),
    budget: { turns: 1, maxResumes: 0, tokenCeiling: 1 },
  };
}

function runOneSession(driver: SessionDriver, kind: string): void {
  driver.runSession({
    def: def(kind),
    initialMessages: [],
    onEvent: () => {},
    signal: new AbortController().signal,
  });
}

/** A workspace on an API provider whose transport reports what a call spent. */
function installBackend(): void {
  setWorkspaceLlmConfigStore({
    getConfig: async () => ({ provider: 'anthropic' as const, model: 'claude-opus-5', apiKey: 'sk-test' }),
    getSelection: async () => ({
      kind: 'api' as const,
      config: { provider: 'anthropic' as const, model: 'claude-opus-5', apiKey: 'sk-test' },
    }),
    getView: async () => null,
    save: async () => {},
  });
  setWorkspaceLlmBackend({
    probe: async () => {},
    driver: () => fakeDriver(),
    transport: (_config, onUsage): LlmTransport => async (req) => {
      onUsage?.({
        stage: req.stage ?? 'unknown',
        model: 'claude-haiku-5',
        inputTokens: 90,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheCreateTokens: 0,
        costUsd: 0.25,
      });
      return '{}';
    },
  });
}

const meterFor = (jobId = JOB) =>
  createUsageMeter(
    { workspaceOrgId: ORG, repoFullName: REPO, jobType: 'repo.guard-generate', jobId },
    { flushMs: 5 },
  );

beforeEach(async () => {
  installed = await installUsageStore();
  installBackend();
});

afterEach(async () => {
  resetWorkspaceLlmConfigStore();
  resetWorkspaceLlmBackend();
  await installed.close();
});

describe('the usage meter', () => {
  it('records a one-shot call as its stage', async () => {
    const meter = meterFor();
    const llm = await startWorkspaceLlm(ORG, meter);

    await llm.transport()({ stage: 'guard.recipe-propose', system: '', user: 'x' });
    await meter.close();

    const runs = await installed.store.runs(ALL, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ jobId: JOB, costUsd: 0.25, tokens: 100, calls: 1 });
    expect(await installed.store.totals(ALL)).toMatchObject({ calls: 1, runs: 1 });
  });

  it('folds a pool of sessions of one kind into one row and counts every turn', async () => {
    const meter = meterFor();
    const llm = await startWorkspaceLlm(ORG, meter);
    const driver = llm.driver();

    runOneSession(driver, 'guard-generate.flow-worker');
    runOneSession(driver, 'guard-generate.flow-worker');
    runOneSession(driver, 'guard-generate.extract');
    await meter.close();

    const rows = await installed.db.query.llmUsage.findMany();
    expect(rows).toHaveLength(2);
    const worker = rows.find((row) => row.subject === 'guard-generate.flow-worker')!;
    expect(worker.calls).toBe(2);
    expect(worker.subjectKind).toBe('session');
    expect(worker.provider).toBe('anthropic');
    // What the RESPONSE said served the turn, not the configured alias.
    expect(worker.model).toBe('claude-opus-5-20260101');
    expect(Number(worker.costUsd)).toBe(1);
    expect(rows.find((row) => row.subject === 'guard-generate.extract')!.calls).toBe(1);
  });

  it('keeps both halves of a run on the one job', async () => {
    const meter = meterFor();
    const llm = await startWorkspaceLlm(ORG, meter);

    runOneSession(llm.driver(), 'guard-generate.flow-worker');
    await llm.transport()({ stage: 'guard.recipe-propose', system: '', user: 'x' });
    await meter.close();

    const runs = await installed.store.runs(ALL, 10);
    expect(runs).toHaveLength(1);
    expect(runs[0]!.costUsd).toBe(0.75);
    expect(runs[0]!.calls).toBe(2);
  });

  it('has the row before the run ends, and grows it as the run goes', async () => {
    const meter = meterFor();
    const llm = await startWorkspaceLlm(ORG, meter);

    runOneSession(llm.driver(), 'guard-generate.flow-worker');
    await meter.flush();
    expect((await installed.store.totals(ALL)).costUsd).toBe(0.5);

    runOneSession(llm.driver(), 'guard-generate.flow-worker');
    await meter.flush();
    expect((await installed.store.totals(ALL)).costUsd).toBe(1);
    expect((await installed.store.runs(ALL, 10))[0]!.calls).toBe(2);

    await meter.close();
  });

  it('names the run on what was already written', async () => {
    const meter = meterFor();
    const llm = await startWorkspaceLlm(ORG, meter);

    runOneSession(llm.driver(), 'guard-generate.flow-worker');
    await meter.flush();
    expect((await installed.store.runs(ALL, 10))[0]!.runId).toBeNull();

    meter.setRunId('run_9');
    // `setRunId` names the rows already written without waiting on the caller.
    await new Promise((resolve) => setTimeout(resolve, 10));
    runOneSession(llm.driver(), 'guard-generate.extract');
    await meter.close();

    const rows = await installed.db.query.llmUsage.findMany();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.runId === 'run_9')).toBe(true);
  });

  it('keeps what a run that threw had spent', async () => {
    const meter = meterFor('job_thrown');
    const llm = await startWorkspaceLlm(ORG, meter);

    await expect(
      (async () => {
        try {
          runOneSession(llm.driver(), 'guard-generate.flow-worker');
          throw new Error('the clone died');
        } finally {
          await meter.close();
        }
      })(),
    ).rejects.toThrow('the clone died');

    const runs = await installed.store.runs(ALL, 10);
    expect(runs.map((row) => row.jobId)).toEqual(['job_thrown']);
    expect(runs[0]!.costUsd).toBe(0.5);
  });

  it('meters nothing when the run was handed no meter', async () => {
    const llm = await startWorkspaceLlm(ORG);

    runOneSession(llm.driver(), 'guard-generate.flow-worker');
    await llm.transport()({ stage: 'guard.recipe-propose', system: '', user: 'x' });

    expect(await installed.store.totals(ALL)).toMatchObject({ runs: 0, calls: 0 });
  });
});
