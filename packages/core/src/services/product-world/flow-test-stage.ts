/**
 * THE FLOW-TEST STAGE — what generate does after flows are synthesized when
 * the product runs from its world scripts: bring the product up ONCE, bare,
 * run every kept test against it, open one flow-test session per flow that
 * needs one, record what each proved, and take the product down.
 *
 * Nothing is seeded ahead of the sessions. Each one writes its flow's seed
 * beside its spec, so the data a test starts from is decided by the flow it
 * proves, is created under names of its own each time it runs, and is shared
 * with no other test. That is what lets the sessions, and the tests, run side
 * by side against the one product.
 *
 * WHICH FLOWS GET A SESSION. A flow with no usable record: no record, one
 * that lacks what a record carries (the run its status was accepted on, or
 * the few words a blocked flow waits on), one whose files are gone, or one
 * whose spec the engine would no longer accept as written. A flow whose
 * fingerprint changed, which is handed its earlier test. And a KEPT test that
 * did not stand at this commit:
 *
 *   - Every kept test with a spec is run again, in one Playwright run, with no
 *     model. One that ends the way it was accepted HOLDS. One that does not
 *     has MOVED, and its session is told how (`flowTestMovement`).
 *   - Every kept test whose judge key is missing or no longer the key of its
 *     files and documents is read by the fidelity judge, while the product
 *     builds. A faithful verdict stamps the record. A flagged one opens a
 *     session on the steps it names.
 *
 * A session that ends without an accepted outcome leaves a new or changed
 * flow with no test: nothing on disk was proven. For a kept test it puts the
 * accepted spec, seed and record back, lists the flow as unsettled, and the
 * next generate tries again, because the test will move again.
 *
 * The stage's second product is a RUN: one result per test with a spec at
 * this commit, the kept test's rerun where it held or nobody settled it, the
 * accepted run where a session wrote or repaired it. A test that held carries
 * no evidence of its own: what it showed is what its accepted run shows.
 *
 * The record of the stage is `tests/tests.json`; the specs and seeds beside it
 * are the tests. Storing them, and the run, is the caller's.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SessionDriver, SessionEvent, SessionPersistence } from '@truecourse/agent-loop';
import {
  bootProductWorld,
  buildProductWorld,
  buildRunId,
  keepFlowTestRun,
  prepareFlowTestsDir,
  readGuardFlowsCorpus,
  releaseWorldSlot,
  reserveWorldSlot,
  runFlowTests,
  type WorldBootFailure,
} from '@truecourse/guard-runner';
import {
  FlowTestsFileSchema,
  flowTestErrorSignature,
  flowTestMovement,
  type FlowTestOutcome,
  type FlowTestRecord,
  type FlowTestRepairReason,
  type FlowTestResult,
  type FlowTestRun,
  type FlowTestRunResult,
  type FlowTestStatus,
  type FlowTestsFile,
  type GuardFlow,
} from '@truecourse/shared';
import {
  flowSeedFileName,
  flowSeedPath,
  flowTestFileName,
  flowTestPath,
  flowTestsDir,
  flowTestsIndexPath,
} from '@truecourse/shared/work-tree';
import { runSessionPool } from '../agent/session-pool.js';
import { describeSessionFailure } from '../guard-setup/session-context.js';
import {
  flowTestFidelityBriefing,
  flowTestFidelityDef,
  flowTestJudgeKey,
  flowTestVerdictOf,
  type FlowTestFidelityOutcome,
  type FlowTestFlaggedStep,
  type FlowTestVerdict,
} from './flow-test-fidelity.js';
import {
  FLOW_TEST_SESSION_TIMEOUT_MS,
  flowTestBriefing,
  flowTestSessionDef,
  specDefect,
  type FlowTestPrior,
  type FlowTestSessionState,
} from './flow-test-session.js';
import { flowStepReader, type FlowTestStep } from './flow-test-steps.js';

/** One judge session's whole wall clock: it reads a briefing and answers. */
const FIDELITY_SESSION_TIMEOUT_MS = 10 * 60_000;

export interface FlowTestStageInput {
  repoRoot: string;
  /** The world's identity on this host (the compose project name). */
  worldId: string;
  /** The generate run this stage is part of; what each accepted test's evidence is kept under. */
  runId: string;
  /** The commit the tree is at: what an accepted status, and the stage's run, are stamped with. */
  commit?: string | null;
  /**
   * Bring a commit into the checkout so a session can diff against it, and say
   * whether it is there. A work tree holds one commit; a moved test's session
   * reads what changed since the commit the test was accepted on.
   */
  fetchCommit?: (commit: string) => Promise<boolean>;
  /** The run's driver and transcript store, built on first use. */
  acquire: () => Promise<{ driver: SessionDriver; persistence: SessionPersistence }>;
  signal?: AbortSignal;
  concurrency?: number;
  /** The checkout is being built, the product brought up, the kept tests run again, then the sessions. */
  onPhase?: (phase: 'build' | 'up' | 'rerun' | 'tests') => void;
  onProgress?: (progress: FlowTestStageProgress) => void;
  onSessionEvent?: (workItem: string, event: SessionEvent) => void;
}

export interface FlowTestStageProgress {
  done: number;
  total: number;
  passing: number;
  failing: number;
  blocked: number;
  /** Sessions that ended without an accepted outcome. */
  unsettled: number;
}

/** A kept test that did not end at this commit the way it was accepted. */
export interface FlowTestMoved {
  flowId: string;
  reason: Exclude<FlowTestRepairReason, 'flow-changed' | 'judge-flagged'>;
  /** What its error says with the particulars taken out; tests one change moved the same way share it. */
  signature: string;
  /** What its session settled it as, or `unsettled` when the session ended without an accepted outcome. */
  settled: FlowTestStatus | 'unsettled';
}

export type FlowTestStageResult =
  | {
      status: 'ok';
      /** Every flow's record: the ones kept from before and the ones this run wrote. */
      tests: FlowTestRecord[];
      /** Flows a session was opened for: new, changed, moved or flagged. */
      authored: number;
      /** Flows whose session ended without an accepted outcome, with why. A reason starting `fidelity:` is the judge's. */
      unsettled: Array<{ flowId: string; reason: string }>;
      /**
       * The tests with a spec as they ran at this commit. Absent when the
       * product was never brought up: every flow is blocked and nothing changed.
       */
      run?: { runId: string; ranAt: string; results: FlowTestRunResult[] };
      /** The kept tests that moved, largest group of one signature first. */
      moved: FlowTestMoved[];
      /** Kept tests the judge read this run, and what it said. */
      judged: { read: number; flagged: number; unavailable: number };
      spent: { sessions: number; turns: number; tokens: number; costUsd: number };
    }
  | { status: 'no-flows' }
  | { status: 'world-failed'; stage: 'build' | WorldBootFailure['stage']; reason: string }
  /** The product came up, and Playwright's run of the kept tests wrote no report. */
  | { status: 'rerun-failed'; reason: string };

/** The flow → test map of a tree, or an empty one when it has none. */
export function readFlowTests(repoRoot: string): FlowTestsFile {
  try {
    return FlowTestsFileSchema.parse(JSON.parse(fs.readFileSync(flowTestsIndexPath(repoRoot), 'utf-8')));
  } catch {
    return { version: 1, generatedAt: new Date(0).toISOString(), tests: [] };
  }
}

/** A flow that gets a session, with its earlier test when it has one. */
interface FlowTestWork {
  flow: GuardFlow;
  prior?: FlowTestPrior;
}

/** A record whose test has a spec to run. */
type RunnableRecord = FlowTestRecord & { status: 'passing' | 'failing'; file: string; run: FlowTestRun };

const runnable = (record: FlowTestRecord): record is RunnableRecord =>
  record.status !== 'blocked' && record.file !== undefined && record.run !== undefined;

export async function runFlowTestStage(input: FlowTestStageInput): Promise<FlowTestStageResult> {
  const { repoRoot } = input;
  const flows = readGuardFlowsCorpus(repoRoot)?.flows ?? [];
  if (flows.length === 0) return { status: 'no-flows' };
  const flowById = new Map(flows.map((flow) => [flow.id, flow]));
  const readSteps = flowStepReader(repoRoot);
  const stepsById = new Map<string, FlowTestStep[]>();
  const stepsOf = (flow: GuardFlow): FlowTestStep[] => {
    let steps = stepsById.get(flow.id);
    if (!steps) stepsById.set(flow.id, (steps = readSteps(flow)));
    return steps;
  };
  const sourcesOf = (record: FlowTestRecord): { spec?: string; seed?: string } => {
    const read = (file: string | undefined): string | undefined =>
      file ? fs.readFileSync(path.join(flowTestsDir(repoRoot), file), 'utf-8') : undefined;
    const spec = read(record.file);
    const seed = read(record.seed);
    return { ...(spec !== undefined ? { spec } : {}), ...(seed !== undefined ? { seed } : {}) };
  };

  // A record is usable while it is whole and, for a flow that has a test, the
  // spec and its seed are still there. A usable record of the flow as it still
  // is, whose spec the engine would accept as written, is KEPT.
  const prior = new Map(readFlowTests(repoRoot).tests.map((t) => [t.flowId, t]));
  const kept = new Map<string, FlowTestRecord>();
  const work: FlowTestWork[] = [];
  for (const flow of flows) {
    const record = prior.get(flow.id);
    const whole = record && (record.status === 'blocked' ? Boolean(record.blockedOn) : Boolean(record.run));
    const files = record ? [record.file, record.seed].flatMap((file) => (file ? [file] : [])) : [];
    if (!record || !whole || files.some((file) => !fs.existsSync(path.join(flowTestsDir(repoRoot), file)))) {
      work.push({ flow });
      continue;
    }
    const sources = sourcesOf(record);
    if (record.flowFingerprint !== flow.fingerprint) {
      work.push({ flow, prior: { reason: 'flow-changed', record, ...sources } });
    } else if (sources.spec !== undefined && specDefect(sources.spec, stepsOf(flow)) !== undefined) {
      work.push({ flow });
    } else {
      kept.set(flow.id, record);
    }
  }
  const standing = [...kept.values()].filter(runnable);

  const written = new Map<string, FlowTestRecord>();
  const unsettled: Array<{ flowId: string; reason: string }> = [];
  const moved: FlowTestMoved[] = [];
  const judged = { read: 0, flagged: 0, unavailable: 0 };
  const spent = { sessions: 0, turns: 0, tokens: 0, costUsd: 0 };
  let run: { runId: string; ranAt: string; results: FlowTestRunResult[] } | undefined;

  // The product comes up whenever there is a test to run or a flow to write.
  if (work.length > 0 || standing.length > 0) {
    const prepared = prepareFlowTestsDir(repoRoot);
    if (!prepared.ok) return { status: 'world-failed', stage: 'scripts', reason: prepared.reason };

    const signal = input.signal ? { signal: input.signal } : {};
    const slot = await reserveWorldSlot(input.worldId);
    // The judge reads the kept tests while the product builds. It is stopped,
    // and waited for, however the stage ends.
    const judgeStop = new AbortController();
    const stopJudge = (): void => judgeStop.abort();
    input.signal?.addEventListener('abort', stopJudge, { once: true });
    if (input.signal?.aborted) stopJudge();
    const judging = judgeKeptTests(input, {
      tests: standing.flatMap((record) => {
        const flow = flowById.get(record.flowId)!;
        const steps = stepsOf(flow);
        const sources = sourcesOf(record);
        const key = flowTestJudgeKey({ steps, spec: sources.spec!, seed: sources.seed });
        return record.judged === key ? [] : [{ flow, steps, record, spec: sources.spec!, ...(sources.seed !== undefined ? { seed: sources.seed } : {}), key }];
      }),
      signal: judgeStop.signal,
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    try {
      input.onPhase?.('build');
      const build = await buildProductWorld(repoRoot, { slot, ...signal });
      if (!build.ok) {
        const how = build.timedOut ? 'did not finish in time' : `exited ${build.exitCode ?? 'without a code'}`;
        return { status: 'world-failed', stage: 'build', reason: `world/build.sh ${how}:\n${build.output}` };
      }
      input.onPhase?.('up');
      const boot = await bootProductWorld(repoRoot, { slot, ...signal });
      if (!boot.ok) return { status: 'world-failed', stage: boot.stage, reason: boot.reason };

      try {
        const world = { id: slot.id, world: boot.running.world };
        const stageRunId = buildRunId();
        const ranAt = new Date().toISOString();
        const commit = input.commit ? { commit: input.commit } : {};

        // Every kept test, as it runs at this commit.
        const reruns = new Map<string, FlowTestResult>();
        if (standing.length > 0) {
          input.onPhase?.('rerun');
          const rerun = await runFlowTests(repoRoot, {
            world,
            tests: standing.map(({ flowId, file }) => ({ flowId, file })),
            label: stageRunId,
            ...signal,
          });
          if (!rerun.ok) return { status: 'rerun-failed', reason: rerun.reason };
          for (const result of rerun.results) reruns.set(result.flowId, result);
        }

        const verdicts = await judging;
        if (!verdicts.ok) throw verdicts.error;
        const flagged = new Map<string, readonly FlowTestFlaggedStep[]>();
        for (const [flowId, { key, verdict }] of verdicts.value) {
          judged.read += 1;
          if (verdict.kind === 'faithful') kept.set(flowId, { ...kept.get(flowId)!, judged: key });
          else if (verdict.kind === 'flagged') {
            judged.flagged += 1;
            flagged.set(flowId, verdict.flagged);
          } else judged.unavailable += 1;
        }

        // A kept test that moved, or that the judge refused, gets a session
        // with the test as it was accepted and the reason it is opened.
        const repairs: FlowTestWork[] = [];
        for (const { flowId } of standing) {
          const record = kept.get(flowId)!;
          const rerun = reruns.get(flowId);
          const movement = rerun ? flowTestMovement(record, rerun) : 'holds';
          if (rerun && movement !== 'holds') {
            moved.push({ flowId, reason: movement, signature: flowTestErrorSignature(rerun.error), settled: 'unsettled' });
          }
          const refused = flagged.get(flowId);
          if (movement === 'holds' && !refused) continue;
          repairs.push({
            flow: flowById.get(flowId)!,
            prior: {
              reason: refused ? 'judge-flagged' : (movement as FlowTestRepairReason),
              record,
              ...sourcesOf(record),
              ...(rerun && movement !== 'holds' ? { rerun } : {}),
              ...(refused ? { flagged: refused } : {}),
            },
          });
        }
        // What a moved test's session diffs against: the commit it was accepted on.
        const fetched = new Map<string, boolean>();
        for (const item of repairs) {
          const accepted = item.prior?.record.run?.commit;
          if (!item.prior?.rerun || !accepted || accepted === input.commit || !input.fetchCommit) continue;
          if (!fetched.has(accepted)) fetched.set(accepted, await input.fetchCommit(accepted).catch(() => false));
          if (fetched.get(accepted)) item.prior.diffBase = accepted;
        }
        work.push(...repairs);

        // The rerun of each kept test, as the stage's run carries it. One that
        // held shows nothing its accepted run does not, so it keeps no evidence.
        const rerunRuns = new Map<string, FlowTestRun>();
        const movedIds = new Set(moved.map((m) => m.flowId));
        for (const [flowId, result] of reruns) {
          rerunRuns.set(
            flowId,
            keepFlowTestRun(repoRoot, {
              runId: stageRunId,
              result,
              specSource: fs.readFileSync(flowTestPath(repoRoot, flowId), 'utf-8'),
              ranAt,
              evidence: movedIds.has(flowId),
              ...commit,
            }),
          );
        }

        /** The engine's run each session's outcome was accepted on. */
        const accepted = new Map<string, FlowTestResult>();
        if (work.length > 0) {
          input.onPhase?.('tests');
          const tally = (): FlowTestStageProgress => {
            const records = [...written.values()];
            return {
              done: records.length + unsettled.length,
              total: work.length,
              passing: records.filter((r) => r.status === 'passing').length,
              failing: records.filter((r) => r.status === 'failing').length,
              blocked: records.filter((r) => r.status === 'blocked').length,
              unsettled: unsettled.length,
            };
          };
          input.onProgress?.(tally());

          // Each flow's session, kept so the fold can read what the engine
          // established while it ran.
          const sessions = new Map<string, FlowTestSessionState>();
          const sessionInput = (item: FlowTestWork) => ({
            repoRoot,
            flow: item.flow,
            steps: stepsOf(item.flow),
            world,
            ...(item.prior ? { prior: item.prior } : {}),
            ...signal,
          });
          const { driver, persistence } = await input.acquire();
          await runSessionPool<FlowTestWork, FlowTestOutcome>({
            items: work,
            workItem: (item) => `flow:${item.flow.id}`,
            session: (item) => {
              const { def, state } = flowTestSessionDef(sessionInput(item));
              sessions.set(item.flow.id, state);
              return def;
            },
            briefing: (item) => [flowTestBriefing(sessionInput(item))],
            driver,
            persistence,
            timeoutMs: FLOW_TEST_SESSION_TIMEOUT_MS,
            ...(input.concurrency ? { concurrency: input.concurrency } : {}),
            ...signal,
            ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
            fold: ({ flow, prior: earlier }, outcome) => {
              const state = sessions.get(flow.id);
              const judge = state?.judgeSpent() ?? { sessions: 0, turns: 0, tokens: 0, costUsd: 0 };
              spent.sessions += 1 + judge.sessions;
              spent.turns += outcome.spent.turns + judge.turns;
              spent.tokens += outcome.spent.tokens + judge.tokens;
              spent.costUsd += outcome.spent.costUsd + judge.costUsd;
              const specPath = flowTestPath(repoRoot, flow.id);
              const seedPath = flowSeedPath(repoRoot, flow.id);
              const was = moved.find((m) => m.flowId === flow.id);
              if (outcome.status === 'completed') {
                const { status, summary, disagreement, blockedBy, blockedOn } = outcome.output;
                const result = status === 'blocked' ? undefined : state?.lastRun();
                const key = status === 'blocked' ? undefined : state?.judged();
                if (result) accepted.set(flow.id, result);
                written.set(flow.id, {
                  flowId: flow.id,
                  flowFingerprint: flow.fingerprint,
                  status,
                  ...(status === 'blocked' ? {} : { file: flowTestFileName(flow.id) }),
                  ...(status !== 'blocked' && fs.existsSync(seedPath) ? { seed: flowSeedFileName(flow.id) } : {}),
                  summary,
                  ...(disagreement ? { disagreement } : {}),
                  ...(blockedBy ? { blockedBy } : {}),
                  ...(blockedOn ? { blockedOn } : {}),
                  ...(result
                    ? {
                        run: keepFlowTestRun(repoRoot, {
                          runId: input.runId,
                          result,
                          specSource: fs.readFileSync(specPath, 'utf-8'),
                          ranAt: new Date().toISOString(),
                          ...commit,
                        }),
                      }
                    : {}),
                  ...(key ? { judged: key } : {}),
                });
                if (was) was.settled = status;
              } else {
                if (earlier && earlier.reason !== 'flow-changed') {
                  // The test this flow had was accepted, and still is its
                  // test: put it back as it was.
                  restore(specPath, earlier.spec);
                  restore(seedPath, earlier.seed);
                } else {
                  // Nobody accepted this spec or its seed: whatever is on disk is unproven.
                  fs.rmSync(specPath, { force: true });
                  fs.rmSync(seedPath, { force: true });
                }
                const refused = state?.flagged();
                unsettled.push({
                  flowId: flow.id,
                  reason: refused ? `fidelity: ${refused}` : describeSessionFailure(outcome.failure),
                });
              }
              input.onProgress?.(tally());
            },
          });
        }

        const results: FlowTestRunResult[] = [];
        for (const flow of flows) {
          const record = written.get(flow.id) ?? kept.get(flow.id);
          if (!record || !runnable(record)) continue;
          const own = written.has(flow.id) ? accepted.get(flow.id) : undefined;
          const rerun = reruns.get(flow.id);
          if (own) results.push({ flowId: flow.id, file: record.file, authored: record.status, outcome: own.outcome, run: record.run });
          else if (rerun) results.push({ flowId: flow.id, file: record.file, authored: record.status, outcome: rerun.outcome, run: rerunRuns.get(flow.id)! });
        }
        run = { runId: stageRunId, ranAt, results };
      } finally {
        await boot.running.down();
      }
    } finally {
      input.signal?.removeEventListener('abort', stopJudge);
      stopJudge();
      await judging;
      releaseWorldSlot(slot);
    }
  }

  const tests = flows.flatMap((flow) => {
    const record = written.get(flow.id) ?? kept.get(flow.id);
    return record ? [record] : [];
  });
  writeFlowTests(repoRoot, tests);
  return {
    status: 'ok',
    tests,
    authored: work.length,
    unsettled,
    ...(run ? { run } : {}),
    moved: bySignatureGroup(moved),
    judged,
    spent,
  };
}

/** Put a file back as it was accepted; one the accepted test did not have is removed. */
function restore(file: string, accepted: string | undefined): void {
  if (accepted === undefined) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, accepted);
}

/** The moved tests with the largest group of one signature first, each group together. */
function bySignatureGroup(moved: readonly FlowTestMoved[]): FlowTestMoved[] {
  const size = new Map<string, number>();
  for (const m of moved) size.set(m.signature, (size.get(m.signature) ?? 0) + 1);
  return [...moved].sort(
    (a, b) => size.get(b.signature)! - size.get(a.signature)! || a.signature.localeCompare(b.signature) || a.flowId.localeCompare(b.flowId),
  );
}

/** A kept test as the judge is handed it. */
interface KeptTestToJudge {
  flow: GuardFlow;
  steps: FlowTestStep[];
  record: RunnableRecord;
  spec: string;
  seed?: string;
  key: string;
}

/**
 * Read each kept test against its claims, one judge session each, and return
 * the verdicts by flow with the key each was given under. The run the judge is
 * shown is the one the record was accepted on. No product is needed.
 */
async function judgeKeptTests(
  input: FlowTestStageInput,
  opts: { tests: KeptTestToJudge[]; signal: AbortSignal },
): Promise<Map<string, { key: string; verdict: FlowTestVerdict }>> {
  const verdicts = new Map<string, { key: string; verdict: FlowTestVerdict }>();
  if (opts.tests.length === 0) return verdicts;
  const { driver, persistence } = await input.acquire();
  await runSessionPool<KeptTestToJudge, FlowTestFidelityOutcome>({
    items: opts.tests,
    workItem: (test) => `flow:${test.flow.id}`,
    session: (test) => flowTestFidelityDef({ steps: test.steps }),
    briefing: (test) => [
      flowTestFidelityBriefing({
        flow: test.flow,
        steps: test.steps,
        spec: test.spec,
        ...(test.seed !== undefined ? { seed: test.seed } : {}),
        run: {
          outcome: test.record.status === 'passing' ? 'pass' : 'fail',
          steps: test.record.run.steps,
          ...(test.record.run.error ? { error: test.record.run.error } : {}),
        },
      }),
    ],
    driver,
    persistence,
    timeoutMs: FIDELITY_SESSION_TIMEOUT_MS,
    ...(input.concurrency ? { concurrency: input.concurrency } : {}),
    signal: opts.signal,
    ...(input.onSessionEvent ? { onSessionEvent: input.onSessionEvent } : {}),
    fold: (test, outcome) => {
      verdicts.set(test.flow.id, { key: test.key, verdict: flowTestVerdictOf(outcome) });
    },
  });
  return verdicts;
}

/** Write the flow → test map, and drop every spec and seed it does not name. */
function writeFlowTests(repoRoot: string, tests: readonly FlowTestRecord[]): void {
  const dir = flowTestsDir(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  const named = new Set(tests.flatMap((t) => [t.file, t.seed].flatMap((file) => (file ? [file] : []))));
  for (const entry of fs.readdirSync(dir)) {
    if (/\.(?:spec|seed)\.ts$/.test(entry) && !named.has(entry)) fs.rmSync(path.join(dir, entry), { force: true });
  }
  fs.rmSync(path.join(dir, 'scratch'), { recursive: true, force: true });
  const file: FlowTestsFile = { version: 1, generatedAt: new Date().toISOString(), tests: [...tests] };
  fs.writeFileSync(flowTestsIndexPath(repoRoot), `${JSON.stringify(file, null, 2)}\n`);
}
