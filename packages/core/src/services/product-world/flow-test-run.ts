/**
 * A RUN OF THE STORED FLOW TESTS — what a run does for a repository whose
 * flows are proven by Playwright tests: bring the product up ONCE from its
 * world scripts, run every test that has a spec against it in one Playwright
 * run, and take the product down, however the run went.
 *
 * The tests were written to share one product: each one's seed creates its
 * starting state under names of its own each time it runs, so they run side
 * by side. Nothing a model decides is involved.
 *
 * The run is its own record. `tests/tests.json` says what each test was
 * accepted on when it was written, and stays exactly that; this run's outcome,
 * steps, error, duration and evidence come back as a run snapshot whose
 * `flowTests` sets each one beside the status it was authored with. Storing it
 * is the caller's.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  bootProductWorld,
  buildProductWorld,
  buildRunId,
  keepFlowTestRun,
  prepareFlowTestsDir,
  releaseWorldSlot,
  reserveWorldSlot,
  runFlowTests,
  type WorldBootFailure,
} from '@truecourse/guard-runner';
import { PRODUCT_WORLD_RECIPE_FINGERPRINT } from '@truecourse/guard-generator';
import {
  tallyFlowTestRun,
  type FlowTestRecord,
  type FlowTestRunResult,
  type GuardLatest,
} from '@truecourse/shared';
import { flowTestsDir } from '@truecourse/shared/work-tree';
import { readFlowTests } from './flow-test-stage.js';

export interface FlowTestRunInput {
  repoRoot: string;
  /** The world's identity on this host (the compose project name). */
  worldId: string;
  /** What the run's envelope records it ran on. */
  branch: string | null;
  commit: string | null;
  /** How many tests run at once against the one product. */
  workers?: number;
  signal?: AbortSignal;
  /** The checkout is being built, then the product brought up, then the tests run. */
  onPhase?: (phase: 'build' | 'up' | 'tests', tests: number) => void;
}

export type FlowTestRunOutcome =
  | { status: 'ok'; latest: GuardLatest }
  /** The tree's tests index names no test with a spec: every flow is blocked, or there is no index. */
  | { status: 'no-tests' }
  | { status: 'world-failed'; stage: 'build' | WorldBootFailure['stage']; reason: string }
  /** Playwright ran but wrote no report, so no test has a result. */
  | { status: 'run-failed'; reason: string };

/** A record whose test has a spec to run. */
type RunnableRecord = FlowTestRecord & { status: 'passing' | 'failing'; file: string };

const runnable = (record: FlowTestRecord): record is RunnableRecord =>
  record.status !== 'blocked' && record.file !== undefined;

export async function runStoredFlowTests(input: FlowTestRunInput): Promise<FlowTestRunOutcome> {
  const { repoRoot } = input;
  const records = readFlowTests(repoRoot).tests.filter(runnable);
  if (records.length === 0) return { status: 'no-tests' };

  const prepared = prepareFlowTestsDir(repoRoot);
  if (!prepared.ok) return { status: 'world-failed', stage: 'scripts', reason: prepared.reason };

  const runId = buildRunId();
  const ranAt = new Date().toISOString();
  const signal = input.signal ? { signal: input.signal } : {};
  const slot = await reserveWorldSlot(input.worldId);
  let run: Awaited<ReturnType<typeof runFlowTests>>;
  try {
    input.onPhase?.('build', records.length);
    const build = await buildProductWorld(repoRoot, { slot, ...signal });
    if (!build.ok) {
      const how = build.timedOut ? 'did not finish in time' : `exited ${build.exitCode ?? 'without a code'}`;
      return { status: 'world-failed', stage: 'build', reason: `world/build.sh ${how}:\n${build.output}` };
    }
    input.onPhase?.('up', records.length);
    const boot = await bootProductWorld(repoRoot, { slot, ...signal });
    if (!boot.ok) return { status: 'world-failed', stage: boot.stage, reason: boot.reason };
    try {
      input.onPhase?.('tests', records.length);
      run = await runFlowTests(repoRoot, {
        world: { id: slot.id, world: boot.running.world },
        tests: records.map(({ flowId, file }) => ({ flowId, file })),
        label: runId,
        ...(input.workers ? { workers: input.workers } : {}),
        ...signal,
      });
    } finally {
      await boot.running.down();
    }
  } finally {
    releaseWorldSlot(slot);
  }
  if (!run.ok) return { status: 'run-failed', reason: run.reason };

  const authored = new Map(records.map((record) => [record.flowId, record.status]));
  const flowTests = run.results.flatMap((result): FlowTestRunResult[] => {
    const status = authored.get(result.flowId);
    if (!status) return [];
    return [
      {
        flowId: result.flowId,
        file: result.file,
        authored: status,
        outcome: result.outcome,
        run: keepFlowTestRun(repoRoot, {
          runId,
          result,
          specSource: fs.readFileSync(path.join(flowTestsDir(repoRoot), result.file), 'utf-8'),
          ranAt,
        }),
      },
    ];
  });

  const tally = tallyFlowTestRun(flowTests);
  return {
    status: 'ok',
    latest: {
      run: {
        runId,
        ranAt,
        branch: input.branch,
        commit: input.commit,
        recipeFingerprint: PRODUCT_WORLD_RECIPE_FINGERPRINT,
      },
      summary: {
        total: tally.run,
        pass: tally.passed,
        fail: tally.failed,
        stale: 0,
        orphaned: 0,
        error: tally.seedFailed,
        blocked: 0,
      },
      scenarios: [],
      sections: [],
      flowTests,
    },
  };
}
