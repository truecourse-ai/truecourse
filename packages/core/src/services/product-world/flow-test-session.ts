/**
 * THE FLOW-TEST SESSION — `guard-generate.flow-test`.
 *
 * One session per flow, with a shell in the checkout and the product running
 * in front of it, writes the Playwright test that proves the flow
 * (`@truecourse/shared`'s `guard/flow-tests.ts` says what a test is). It finds
 * out how to drive the product by driving it: there is no catalog of screens
 * or endpoints to look anything up in, and none is needed.
 *
 * WHAT the test asserts comes from the documents the flow is made of, which
 * the briefing quotes. The product only answers HOW each step is reached. A
 * product that does something other than what its documents say is the finding
 * this whole pipeline exists to make, so the test keeps the documented
 * assertion and is recorded as failing there.
 *
 * The product is up BARE, so the session also writes the flow's SEED: the
 * module that creates what the flow starts from, under names no other run has,
 * each time the test runs. Nothing was seeded ahead of the flows, so a seed
 * holds exactly what its own flow calls for and no two tests share data.
 *
 * The engine holds the result to two things. Its own run of seed and spec
 * together (`run_test`, the same call every later run makes): `passing` must
 * pass, `failing` must fail in the test and never in the seed, and `blocked`
 * leaves neither file behind. And the judge's reading of the files as they
 * stand (`review_test`, `flow-test-fidelity.ts`): an outcome is accepted only
 * under a `faithful` verdict on exactly those files. A session cannot report a
 * test the engine did not see behave that way, nor one whose steps do not
 * observe what the documents say.
 *
 * The spec's top-level `test.step` titles ARE the flow's claim titles, in
 * order, and that is checked. It is what lets a reader, the judge and a later
 * session all mean the same step by the same words.
 *
 * A NAME is not a finding. Where the documents call a control one thing and
 * the product another, the session uses the product's name, goes on to what
 * the step is about, and declares the difference as COPY DRIFT: to
 * `review_test`, which reads the spec knowing it, and in its outcome. An
 * outcome stands only on the verdict given over exactly the list it carries.
 *
 * A flow that already has a test is opened with a REASON and the earlier test
 * (`FlowTestPrior`): the flow changed, the test moved at this commit, its seed
 * stopped holding, a failing test started passing, or the judge refused it.
 * The reason decides what the briefing adds and what the session may not
 * change, which is checked on the files before anything runs.
 *
 * Needs a backend that can hand a session a shell, which is Claude Code.
 */

import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import {
  COMPUTER_TOOLS,
  defineSessionKind,
  defineToolSpec,
  type SessionDef,
  type SessionTool,
  type ToolContext,
} from '@truecourse/agent-loop';
import { FLOW_TEST_ENV, flowSpecStepTitles, flowTestEnv, runFlowTests, type FlowTestWorld } from '@truecourse/guard-runner';
import {
  FlowTestCopyDriftSchema,
  FlowTestOutcomeSchema,
  flowTestFailedStep,
  orderCopyDrift,
  type FlowTestCopyDrift,
  type FlowTestOutcome,
  type FlowTestRecord,
  type FlowTestRepairReason,
  type FlowTestResult,
  type GuardFlow,
} from '@truecourse/shared';
import {
  flowSeedFileName,
  flowSeedPath,
  flowTestFileName,
  flowTestPath,
  flowTestsDir,
} from '@truecourse/shared/work-tree';
import {
  copyDriftLine,
  describeFlagged,
  flowTestFidelityBriefing,
  flowTestFidelityDef,
  flowTestJudgeKey,
  flowTestVerdictOf,
  type FlowTestFlaggedStep,
  type FlowTestVerdict,
} from './flow-test-fidelity.js';
import { flowStepQuotes, type FlowTestStep } from './flow-test-steps.js';

export type { FlowTestStep } from './flow-test-steps.js';

export const FLOW_TEST_SESSION_KIND = 'guard-generate.flow-test';

export const FLOW_TEST_SESSION_BUDGET = { turns: 80, maxResumes: 1, tokenCeiling: 2_000_000 } as const;

/** One flow's whole wall clock: exploring a few screens, a seed, writing, a handful of runs. */
export const FLOW_TEST_SESSION_TIMEOUT_MS = 45 * 60_000;

/** How much of an error a briefing quotes. */
const ERROR_QUOTE_CHARS = 4_000;

const FLOW_TEST_SESSION = defineSessionKind({
  kind: FLOW_TEST_SESSION_KIND,
  outcomeSchema: FlowTestOutcomeSchema,
});

/**
 * The test a flow already has, and why it is being opened again. The sources
 * are the files as they were accepted, which are also what is on disk at the
 * session's paths when it starts.
 */
export interface FlowTestPrior {
  reason: FlowTestRepairReason;
  record: FlowTestRecord;
  /** The accepted spec and seed. Absent for a `blocked` record, which has neither. */
  spec?: string;
  seed?: string;
  /** How the kept test ran at this commit, for a test that was run again. */
  rerun?: FlowTestResult;
  /** The steps the judge refused, with why. */
  flagged?: readonly FlowTestFlaggedStep[];
  /** The commit the record was accepted on, when the checkout has it to diff against. */
  diffBase?: string;
}

export interface FlowTestSessionInput {
  repoRoot: string;
  flow: GuardFlow;
  steps: readonly FlowTestStep[];
  /** The running product, and the id it was brought up under. */
  world: FlowTestWorld;
  /** The flow's earlier test and why this session was opened. Absent for a flow that has none. */
  prior?: FlowTestPrior;
  signal?: AbortSignal;
}

/** A session's view of what the engine established, for the caller that folds the outcome. */
export interface FlowTestSessionState {
  /** The engine's last run of the spec. */
  lastRun(): FlowTestResult | undefined;
  /** The judge key of the files as they stand with this copy drift, when a faithful verdict covers them. */
  judged(copyDrift?: readonly FlowTestCopyDrift[]): string | undefined;
  /** What the judge's last reading refused, when it refused. */
  flagged(): string | undefined;
  /** What the judge's child sessions cost; a session's own spend does not include them. */
  judgeSpent(): { sessions: number; turns: number; tokens: number; costUsd: number };
}

type SpecRun = { ok: true; result: FlowTestResult } | { ok: false; reason: string };

export function flowTestSessionDef(input: FlowTestSessionInput): {
  def: SessionDef<FlowTestOutcome>;
  state: FlowTestSessionState;
} {
  const file = flowTestFileName(input.flow.id);
  const specPath = flowTestPath(input.repoRoot, input.flow.id);
  const specRel = path.relative(input.repoRoot, specPath);
  const seedPath = flowSeedPath(input.repoRoot, input.flow.id);
  const seedRel = path.relative(input.repoRoot, seedPath);
  const { prior } = input;
  let lastRun: { files: string; result: FlowTestResult } | undefined;
  let lastVerdict: FlowTestVerdict | undefined;
  const judgeSpent = { sessions: 0, turns: 0, tokens: 0, costUsd: 0 };
  // Verdicts by judge key. A kept test's verdict stands for as long as its key does.
  const verdicts = new Map<string, FlowTestVerdict>();
  if (prior?.record.judged) verdicts.set(prior.record.judged, { kind: 'faithful' });

  /**
   * The spec and seed as they stand, or why they are not a test yet. `key` is
   * the judge key of the files alone, which is how a run knows them; a verdict
   * is given under `judgeKey`, over the files and a copy drift list.
   */
  const readFiles = ():
    | { ok: true; spec: string; seed?: string; key: string; judgeKey: (copyDrift: readonly FlowTestCopyDrift[]) => string }
    | { ok: false; reason: string } => {
    if (!fs.existsSync(specPath)) return { ok: false, reason: `There is no spec at ${specRel} yet.` };
    const spec = fs.readFileSync(specPath, 'utf-8');
    const seed = fs.existsSync(seedPath) ? fs.readFileSync(seedPath, 'utf-8') : undefined;
    const defect =
      specDefect(spec, input.steps) ?? (seed !== undefined ? seedDefect(seed, spec, flowSeedFileName(input.flow.id)) : undefined);
    if (defect) return { ok: false, reason: defect };
    const judgeKey = (copyDrift: readonly FlowTestCopyDrift[]): string => flowTestJudgeKey({ steps: input.steps, spec, seed, copyDrift });
    return { ok: true, spec, ...(seed !== undefined ? { seed } : {}), key: judgeKey([]), judgeKey };
  };

  const runSpec = async (signal?: AbortSignal): Promise<SpecRun> => {
    lastRun = undefined;
    const files = readFiles();
    if (!files.ok) return files;
    const run = await runFlowTests(input.repoRoot, {
      world: input.world,
      tests: [{ flowId: input.flow.id, file }],
      workers: 1,
      label: input.flow.id,
      ...(signal ? { signal } : {}),
    });
    if (!run.ok) return run;
    lastRun = { files: files.key, result: run.results[0] };
    return { ok: true, result: run.results[0] };
  };

  /**
   * The judge's reading of the files as they stand with the copy drift the
   * session declares: the verdict already given under that key, or a new one.
   */
  const review: ReviewTest = async (ctx, declared) => {
    const files = readFiles();
    if (!files.ok) return { ok: false, reason: files.reason };
    const copyDrift = orderCopyDrift(declared);
    const defect = copyDriftDefect(copyDrift, input.steps);
    if (defect) return { ok: false, reason: defect };
    const judgeKey = files.judgeKey(copyDrift);
    const known = verdicts.get(judgeKey);
    if (known) {
      lastVerdict = known;
      return { ok: true, verdict: known, fresh: false };
    }
    const run: SpecRun = lastRun?.files === files.key ? { ok: true, result: lastRun.result } : await runSpec(ctx.signal);
    if (!run.ok) return { ok: false, reason: run.reason };
    const { result } = run;
    if (result.outcome !== 'pass' && result.outcome !== 'fail') {
      return {
        ok: false,
        reason:
          result.outcome === 'seed-failed'
            ? `The seed (${seedRel}) did not hold, so there is no run of the test to judge:\n\n${result.error ?? '(no error text)'}`
            : `The engine's run of ${specRel} ended ${result.outcome}, so there is no run of the test to judge.`,
      };
    }
    const outcome = await ctx.dispatchChild(flowTestFidelityDef({ steps: input.steps }), [
      flowTestFidelityBriefing({
        flow: input.flow,
        steps: input.steps,
        spec: files.spec,
        ...(files.seed !== undefined ? { seed: files.seed } : {}),
        copyDrift,
        run: { outcome: result.outcome, steps: result.steps, ...(result.error ? { error: result.error } : {}) },
      }),
    ]);
    judgeSpent.sessions += 1;
    judgeSpent.turns += outcome.spent.turns;
    judgeSpent.tokens += outcome.spent.tokens;
    judgeSpent.costUsd += outcome.spent.costUsd;
    const verdict = flowTestVerdictOf(outcome);
    // No verdict is no reading: nothing is remembered, and the next call asks again.
    if (verdict.kind !== 'unavailable') {
      verdicts.set(judgeKey, verdict);
      lastVerdict = verdict;
    }
    return { ok: true, verdict, fresh: true };
  };

  const def: SessionDef<FlowTestOutcome> = {
    ...FLOW_TEST_SESSION,
    reasoning: 'high',
    display: {
      title: 'Flow test',
      intro: prior
        ? `I'm looking again at the Playwright test for "${input.flow.title}", against the running product: ${REASON_INTRO[prior.reason]}.`
        : `I'm writing the Playwright test for "${input.flow.title}" and the seed it starts from, against the running product.`,
    },
    systemPrompt: SYSTEM_PROMPT,
    computer: {
      cwd: input.repoRoot,
      tools: COMPUTER_TOOLS,
      env: flowTestEnv(input.repoRoot, input.world),
    },
    tools: [runTestTool(specRel, runSpec), reviewTestTool(specRel, review)],
    budget: FLOW_TEST_SESSION_BUDGET,
    // The gate of record: what may not have changed, the judge's verdict on the
    // files as they stand, then the engine's own run of them, held against
    // what the session says they prove.
    async validateOutcome(outcome) {
      if (outcome.status === 'blocked') {
        const left = [specPath, seedPath].filter((file) => fs.existsSync(file)).map((file) => path.relative(input.repoRoot, file));
        return left.length > 0
          ? `Outcome refused: a blocked flow has no test and no seed, but ${left.join(' and ')} exist${left.length === 1 ? 's' : ''}. Delete ${left.length === 1 ? 'it' : 'them'}, or finish the test and report what it proves.`
          : undefined;
      }
      const changed = restoreFrozen(prior, { specPath, seedPath, specRel, seedRel });
      if (changed) return `Outcome refused: ${changed}`;
      const files = readFiles();
      if (!files.ok) return `Outcome refused: ${files.reason}`;
      const copyDrift = orderCopyDrift(outcome.copyDrift ?? []);
      const driftDefect = copyDriftDefect(copyDrift, input.steps);
      if (driftDefect) return `Outcome refused: ${driftDefect}`;
      const verdict = verdicts.get(files.judgeKey(copyDrift));
      if (verdict?.kind === 'flagged') {
        return `Outcome refused: \`review_test\` read the spec and seed as they are now and did not accept them:\n\n${flaggedLines(verdict.flagged)}\n\nMake each of those steps observe what its document says, then call \`review_test\` again. If the product cannot be made to show it, the flow is \`blocked\`.`;
      }
      if (!verdict) {
        return `Outcome refused: \`review_test\` has not accepted the spec and seed as they are now with the copy drift this outcome reports (${copyDrift.length > 0 ? copyDrift.map(copyDriftLine).join('; ') : 'none'}). It has not run, the files changed since, or it was given a different \`copyDrift\`. An outcome stands only on files it read and found faithful, knowing exactly that list. Call \`review_test\` with it.`;
      }
      const run = await runSpec(input.signal);
      if (!run.ok) return `Outcome refused: ${run.reason}`;
      const { result } = run;
      if (result.outcome === 'seed-failed') {
        return `Outcome refused: the engine's run never reached the test, because the seed (${seedRel}) did not hold:\n\n${result.error ?? '(no error text)'}\n\nA seed that fails is not a finding about the product. Fix the seed. If what the flow starts from cannot be created in this world at all, the status is \`blocked\`.`;
      }
      if (outcome.status === 'passing' && result.outcome !== 'pass') {
        return `Outcome refused: you reported the test passing, and the engine's run of it ended ${result.outcome}:\n\n${result.error ?? '(no error text)'}\n\nIf the product really does something other than what the documents say, the status is \`failing\` with the disagreement named. Otherwise fix the test.`;
      }
      if (outcome.status === 'failing' && result.outcome !== 'fail') {
        return `Outcome refused: you reported the test failing on a disagreement, and the engine's run of it ended ${result.outcome}. A test that passes is \`passing\`.`;
      }
      return undefined;
    },
  };
  return {
    def,
    state: {
      lastRun: () => lastRun?.result,
      judged: (copyDrift = []) => {
        const files = readFiles();
        if (!files.ok) return undefined;
        const judgeKey = files.judgeKey(orderCopyDrift(copyDrift));
        return verdicts.get(judgeKey)?.kind === 'faithful' ? judgeKey : undefined;
      },
      flagged: () => (lastVerdict?.kind === 'flagged' ? describeFlagged(lastVerdict.flagged) : undefined),
      judgeSpent: () => ({ ...judgeSpent }),
    },
  };
}

const REASON_INTRO: Record<FlowTestRepairReason, string> = {
  'flow-changed': 'the flow it proves has changed',
  moved: 'it no longer ends the way it was accepted',
  'seed-failed': 'its seed no longer holds',
  'now-passing': 'it was failing on a disagreement and now passes',
  'judge-flagged': 'a review found steps that do not observe what the documents say',
};

/**
 * What a reason forbids changing, held on the files themselves: a seed repair
 * leaves the spec as it was accepted, and a failing test that now passes
 * leaves both. A frozen file that differs is put back as it was accepted, and
 * the refusal says so; nothing is returned when they stand.
 */
function restoreFrozen(
  prior: FlowTestPrior | undefined,
  at: { specPath: string; seedPath: string; specRel: string; seedRel: string },
): string | undefined {
  if (!prior || (prior.reason !== 'seed-failed' && prior.reason !== 'now-passing')) return undefined;
  const putBack = (file: string, accepted: string | undefined): boolean => {
    const now = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : undefined;
    if (now === accepted) return false;
    if (accepted === undefined) fs.rmSync(file, { force: true });
    else fs.writeFileSync(file, accepted);
    return true;
  };
  const restored = [
    ...(putBack(at.specPath, prior.spec) ? [at.specRel] : []),
    ...(prior.reason === 'now-passing' && putBack(at.seedPath, prior.seed) ? [at.seedRel] : []),
  ];
  if (restored.length === 0) return undefined;
  const why =
    prior.reason === 'seed-failed'
      ? 'This session repairs the seed, and only the seed may change.'
      : 'The test was accepted failing and passes now, which says something about the product only while the test is the one that was accepted.';
  return `${restored.join(' and ')} ${restored.length === 1 ? 'was' : 'were'} not as accepted, and ${restored.length === 1 ? 'has' : 'have'} been put back byte for byte. ${why} Run and review the test as it stands now.`;
}

function flaggedLines(flagged: readonly FlowTestFlaggedStep[]): string {
  return flagged.map((f) => `- step ${f.step}: ${f.mismatch}`).join('\n');
}

/**
 * What a copy drift list may not say, as the reason it is refused: a step the
 * flow does not have, or a name that is the same on both sides. Whether an
 * entry really is a name and nothing more is the judge's to say.
 */
function copyDriftDefect(copyDrift: readonly FlowTestCopyDrift[], steps: readonly FlowTestStep[]): string | undefined {
  const orders = new Set(steps.map((step) => step.order));
  const unknown = copyDrift.filter((drift) => !orders.has(drift.step));
  if (unknown.length > 0) {
    return `\`copyDrift\` names step ${[...new Set(unknown.map((drift) => drift.step))].join(', ')}, and the flow's steps are ${[...orders].join(', ')}. Each entry carries the number of the step it was met in.`;
  }
  const same = copyDrift.find((drift) => drift.documented.trim() === drift.observed.trim());
  if (same) {
    return `\`copyDrift\` says the document and the product both have ${JSON.stringify(same.observed)} in step ${same.step}. An entry is a name that DIFFERS: \`documented\` as the document has it, \`observed\` as the product has it.`;
  }
  return undefined;
}

/**
 * What a spec may not contain, as the reason it is refused. These are the
 * ways a test stops meaning what its result says: skipped, expected to fail,
 * narrowed to part of itself, or stepped differently from the flow it proves.
 */
export function specDefect(source: string, steps: readonly FlowTestStep[]): string | undefined {
  if (!/from ['"]\.\/flow['"]/.test(source)) {
    return "The spec does not import from './flow'. Its `test` comes from there (`test`, or `flowTest(seed)`), which is what records each step.";
  }
  if (!/\bexpect\s*[.(]/.test(source)) return 'The spec asserts nothing: it has no `expect`.';
  const banned = source.match(/\b(?:test|it|describe)\.(?:skip|fixme|fail|only)\b|\.describe\.(?:skip|fixme|only)\b/);
  if (banned) {
    return `The spec uses \`${banned[0]}\`. A test here runs whole and means what its result says: no skip, fixme, fail or only.`;
  }
  const titles = flowSpecStepTitles(source);
  const expected = steps.map((step) => step.claimTitle);
  if (titles.length !== expected.length || titles.some((title, index) => title !== expected[index])) {
    return [
      `The spec's \`test.step\` calls are not the flow's steps. It has exactly one \`test.step\` per step of the flow, in order, at the top level of the test, each titled with that step's claim title character for character, as a plain string. There is no other \`test.step\`, and none nested in another.`,
      '',
      'The flow has:',
      ...(expected.length > 0 ? expected.map((title, index) => `  ${index + 1}. ${title}`) : ['  (no steps)']),
      'The spec has:',
      ...(titles.length > 0 ? titles.map((title, index) => `  ${index + 1}. ${title}`) : ['  (no test.step)']),
      '',
      'A step that cannot be observed on its own is not merged into its neighbour: when a claim of the flow cannot be proven here, the flow is `blocked` on what stands in the way.',
    ].join('\n');
  }
  return undefined;
}

/**
 * What a seed may not be, as the reason it is refused: unused by its spec, or
 * creating things under fixed names, which is what makes two tests collide.
 */
function seedDefect(source: string, spec: string, file: string): string | undefined {
  const module = file.replace(/\.ts$/, '');
  if (!/\bexport\s+(?:async\s+function|const)\s+seed\b/.test(source)) return `${file} does not export a \`seed\` function.`;
  if (!spec.includes(`./${module}`) || !/\bflowTest\s*\(/.test(spec)) {
    return `${file} exists and the spec does not run it. The spec takes its \`test\` from \`flowTest(seed)\`, with \`seed\` imported from './${module}'. A flow that starts from nothing has no seed file.`;
  }
  if (!/\bunique\b/.test(source)) {
    return `${file} never uses \`unique\`. Everything a seed creates is named with it, so that no other test and no earlier run of this one holds the same thing.`;
  }
  return undefined;
}

const RUN_TEST = defineToolSpec({
  name: 'run_test',
  description:
    "The engine runs THIS flow's seed and spec against the running product, exactly as every later run will. Returns whether the test passed, with the failing assertion when it did not, and says so when it was the seed that did not hold. It is the check your outcome is held to.",
  kind: 'run-flow-test',
  readOnly: false,
  destructive: false,
  inputSchema: z.object({}).strict(),
});

function runTestTool(specRel: string, runSpec: (signal?: AbortSignal) => Promise<SpecRun>): SessionTool {
  return RUN_TEST.bind({
    async execute(_args, ctx) {
      const run = await runSpec(ctx.signal);
      if (!run.ok) return { content: run.reason, isError: true };
      const { result } = run;
      const seconds = (result.durationMs / 1000).toFixed(1);
      if (result.outcome === 'pass') return { content: `PASSED in ${seconds}s: ${specRel}` };
      const trace = result.attachments.find((a) => a.name === 'trace');
      const headline = {
        fail: `FAILED in ${seconds}s: ${specRel}`,
        skipped: `SKIPPED in ${seconds}s: ${specRel}`,
        'seed-failed': `SEED FAILED: the seed did not hold, so the test in ${specRel} never started. This is the seed's defect, not the product's.`,
      }[result.outcome];
      return {
        content: [
          headline,
          '',
          result.error ?? '(no error text)',
          ...(trace ? ['', `trace: ${trace.path}`] : []),
        ].join('\n'),
        isError: true,
      };
    },
  });
}

const REVIEW_TEST = defineToolSpec({
  name: 'review_test',
  description:
    'A reviewer with a fresh context reads your spec and seed AS THEY ARE NOW against the claims of the flow, with how the engine\'s last run of them went, and answers whether every step observes what its document promises. Give it the `copyDrift` your outcome will report (every name the document has one way and the product another), or nothing when there is none: it reads the spec knowing that list, and holds each entry to being a name. Returns FAITHFUL, or the steps it refuses with what each fails to observe. An outcome is accepted only when this accepted the files as they are at that moment with that same list: any edit after it, or a different list, means calling it again. It runs the test first when the files changed since `run_test`.',
  kind: 'review-flow-test',
  readOnly: true,
  destructive: false,
  inputSchema: z.object({ copyDrift: z.array(FlowTestCopyDriftSchema).optional() }).strict(),
});

type ReviewTest = (
  ctx: ToolContext,
  copyDrift: readonly FlowTestCopyDrift[],
) => Promise<{ ok: true; verdict: FlowTestVerdict; fresh: boolean } | { ok: false; reason: string }>;

function reviewTestTool(specRel: string, review: ReviewTest): SessionTool {
  return REVIEW_TEST.bind({
    async execute(args, ctx) {
      const reviewed = await review(ctx, args.copyDrift ?? []);
      if (!reviewed.ok) return { content: reviewed.reason, isError: true };
      const { verdict } = reviewed;
      if (verdict.kind === 'unavailable') {
        return { content: `The review did not finish (${verdict.reason}), so there is no verdict. Call \`review_test\` again.`, isError: true };
      }
      if (verdict.kind === 'faithful') return { content: `FAITHFUL: ${specRel} and its seed, as they are now, observe what the documents say at every step.` };
      return {
        content: [
          `FLAGGED (${verdict.confidence} confidence)${reviewed.fresh ? '' : ', as before: the files have not changed since this verdict'}:`,
          '',
          flaggedLines(verdict.flagged),
          '',
          'Each line is a step that would still pass if the product did not do what its document says, or that fails on something the document does not promise. Make the step observe it, then run and review again. Do not argue with the verdict in comments, and do not answer it by rewording a title: the reviewer reads only the files.',
        ].join('\n'),
        isError: true,
      };
    },
  });
}

export function flowTestBriefing(input: FlowTestSessionInput): string {
  const { flow, prior } = input;
  const { world } = input.world;
  const file = flowTestFileName(flow.id);
  const testsRel = path.relative(input.repoRoot, flowTestsDir(input.repoRoot));
  const scratch = file.replace(/\.spec\.ts$/, '');
  const startsFrom = [...(flow.startingState?.seedable ?? []), ...(flow.startingState?.stepCreatable ?? [])];
  const supplied = flow.startingState?.supplied ?? [];
  return [
    prior
      ? `Look again at the test of ONE flow, and the seed it starts from: "${flow.title}" (${flow.id}).`
      : `Write the test for ONE flow, and the seed it starts from: "${flow.title}" (${flow.id}).`,
    `Goal: ${flow.goal}`,
    ...(flow.notes ? [`Notes from whoever composed the flow: ${flow.notes}`] : []),
    '',
    ...(prior ? [...priorBriefing(input, prior), ''] : []),
    ...(startsFrom.length > 0
      ? [
          'What the flow starts from, as whoever composed it saw it. Your seed creates this, except what a step of the flow itself creates:',
          ...startsFrom.map((line) => `- ${line}`),
          '',
        ]
      : []),
    ...(supplied.length > 0
      ? [
          'What it needs from outside the product. The flow is blocked when this world does not have it:',
          ...supplied.map((line) => `- ${line}`),
          '',
        ]
      : []),
    'The path, in order. Each step is something the documents say the product does, and its first line is the title of its `test.step`:',
    '',
    ...flowStepQuotes(input.steps),
    'The running product. It was brought up bare: nothing in it was created for a test.',
    `- baseUrl: ${world.baseUrl} (Playwright's \`baseURL\`, so \`page.goto('/')\` opens it)`,
    ...Object.entries(world.urls).map(([name, url]) => `- urls.${name}: ${url}`),
    ...world.accounts.map(
      (a) =>
        `- account "${a.name}", made by the product's own installation${a.role ? `: ${a.role}` : ''}${a.token ? ' (has an API token)' : ''}${a.notes ? `. ${a.notes}` : ''}`,
    ),
    ...(world.notes ? [`- notes: ${world.notes}`] : []),
    `- ${FLOW_TEST_ENV.worldId}=${input.world.id} names its containers; your shell, your seed and your test all have it`,
    '',
    `The repository root is your working directory: ${input.repoRoot}`,
    `The tests directory: ${testsRel}`,
    `Your spec: ${path.join(testsRel, file)}`,
    `Your seed: ${path.join(testsRel, flowSeedFileName(flow.id))}`,
    `Your scratch directory: ${path.join(testsRel, 'scratch', scratch)}/`,
    `To run a scratch spec: cd ${testsRel} && node node_modules/@playwright/test/cli.js test scratch/${scratch}/<file>.spec.ts --reporter=line`,
  ].join('\n');
}

/** Why the session was opened, what the earlier test was, and what may not change. */
function priorBriefing(input: FlowTestSessionInput, prior: FlowTestPrior): string[] {
  const { record, rerun } = prior;
  const acceptedAs = [
    record.status === 'blocked'
      ? `It has no test. It was recorded as blocked on: ${record.blockedOn ?? record.blockedBy ?? '(nothing named)'}${record.blockedBy && record.blockedOn ? ` (${record.blockedBy})` : ''}`
      : `The earlier test is at your paths: the spec${prior.seed !== undefined ? ' and its seed' : ', which has no seed'}. It was accepted as ${record.status}${record.run?.commit ? ` at commit ${record.run.commit.slice(0, 12)}` : ''}.`,
    ...(record.status !== 'blocked' ? [`What it was said to prove: ${record.summary}`] : []),
    ...(record.disagreement
      ? [`The disagreement it failed on. Documented: ${record.disagreement.documented} Observed: ${record.disagreement.observed}`]
      : []),
    ...(record.copyDrift?.length
      ? [
          'The copy drift it was accepted with. Whatever of it the test still meets is reported again, in `review_test` and in your outcome:',
          ...record.copyDrift.map((drift) => `- ${copyDriftLine(drift)}`),
        ]
      : []),
  ];
  const acceptedSteps = (record.run?.steps ?? []).map((step) => `  ${step.order}. ${step.outcome === 'passed' ? 'passed' : step.outcome === 'failed' ? 'FAILED' : 'not reached'}: ${step.title}`);
  const rerunLines = rerun
    ? [
        ...(rerun.steps.length > 0
          ? ['How it ran at this commit:', ...rerun.steps.map((step) => `  ${step.order}. ${step.outcome === 'failed' ? 'FAILED' : 'passed'}: ${step.title}`)]
          : []),
        ...(rerun.error ? ['The error:', ...clip(rerun.error, ERROR_QUOTE_CHARS).split('\n').map((line) => `  | ${line}`)] : []),
        ...rerun.attachments.filter((a) => a.name === 'trace').map((a) => `The trace of that run: ${a.path}`),
      ]
    : [];
  const diff = prior.diffBase
    ? [`What changed in the repository since it was accepted: \`git diff ${prior.diffBase} HEAD\` (add \`--stat\` first; the checkout has both commits and nothing between them).`]
    : [];

  switch (prior.reason) {
    case 'flow-changed': {
      if (record.status === 'blocked') {
        return [
          '# Why this session was opened',
          'The flow changed since it was last looked at.',
          ...acceptedAs,
          'See whether the flow as it is now can be tested. If it is still blocked on the same thing, say so in the same words: `blockedOn` is what flows blocked on one thing are listed under.',
        ];
      }
      return [
        '# Why this session was opened',
        'The flow changed since its test was written. The test proved the flow as it was.',
        ...acceptedAs,
        ...stepDiff((record.run?.steps ?? []).map((step) => step.title), input.steps.map((step) => step.claimTitle)),
        'Work from the earlier spec and seed, do not start over. Leave the code of a step whose claim is the same exactly as it is, unless a new or moved step forces a change to it, and say in the summary when one did. Write the new steps, remove the gone ones, and put moved ones where the flow now has them.',
      ];
    }
    case 'moved': {
      const failedAt = flowTestFailedStep(rerun?.steps ?? []);
      const was =
        record.status === 'passing'
          ? 'It was accepted passing, and at this commit it fails'
          : `It was accepted failing${flowTestFailedStep(record.run?.steps ?? []) ? ` at step ${flowTestFailedStep(record.run?.steps ?? [])}` : ''}, and at this commit it ends differently`;
      return [
        '# Why this session was opened',
        `The flow has not changed, and its test no longer ends the way it was accepted. ${was}${failedAt ? `, at step ${failedAt}` : ''}${rerun && rerun.outcome !== 'fail' ? ` (the run ended ${rerun.outcome})` : ''}.`,
        ...acceptedAs,
        ...(acceptedSteps.length > 0 ? ['How its accepted run went:', ...acceptedSteps] : []),
        ...rerunLines,
        ...diff,
        'Decide which of two things happened, by looking at the product:',
        '- The product changed how a step is REACHED (a control renamed or moved, a page restructured, a route changed) and still does what the document says. Fix the locator or the navigation, and end `passing`. This is the test having aged, not a finding. A control renamed away from the name the document still uses is copy drift: report it.',
        '- The product no longer DOES what the document says. Keep the assertion, and end `failing` with the disagreement. This is a regression, and the finding this run exists to make.',
        'What may not change: the list of steps, and what each step asserts. Never make this test pass by asserting less. `review_test` reads the repaired spec against the documents again.',
      ];
    }
    case 'seed-failed':
      return [
        '# Why this session was opened',
        'The flow has not changed. At this commit its seed no longer holds, so the test never starts.',
        ...acceptedAs,
        ...rerunLines,
        ...diff,
        'Repair the SEED, and only the seed: find how the starting state comes to exist in the product as it is now. The spec stays exactly as it was accepted, byte for byte, and that is checked before anything runs.',
        `The test then ends on the status it had (${record.status}), as the engine's run shows. If the starting state can no longer be created in this world by any means, the flow is \`blocked\`.`,
      ];
    case 'now-passing':
      return [
        '# Why this session was opened',
        'The flow has not changed. Its test was accepted FAILING on a disagreement between the documents and the product, and at this commit it passes.',
        ...acceptedAs,
        ...(acceptedSteps.length > 0 ? ['How its accepted run went:', ...acceptedSteps] : []),
        ...diff,
        'The spec and the seed are frozen: both stay exactly as they were accepted, byte for byte, and that is checked before anything runs. A test that passes because it was edited says nothing about the product.',
        'Confirm it: call `run_test`, and look at the product at the step that used to fail to see that it now does what the document says. Then end `passing`, with a summary of what the test proves now. If the engine\'s run fails again, the pass was not real: end `failing` with the disagreement as it stands.',
      ];
    case 'judge-flagged':
      return [
        '# Why this session was opened',
        'The flow has not changed. A reviewer read its kept test against the documents and did not accept it:',
        ...(prior.flagged ?? []).map((f) => `- step ${f.step}: ${f.mismatch}`),
        ...acceptedAs,
        ...rerunLines,
        'Make each of those steps observe what its document says. Leave the steps the review did not name exactly as they are. If, once a step asserts what the document says, the product turns out not to do it, that is the finding: end `failing` with the disagreement.',
      ];
  }
}

/** A changed flow's steps set against the earlier test's, by title. */
function stepDiff(before: readonly string[], after: readonly string[]): string[] {
  const lines = after.map((title, index) => {
    const was = before.indexOf(title);
    const word = was === -1 ? 'NEW' : was === index ? 'the same' : `MOVED (was step ${was + 1})`;
    return `  ${index + 1}. ${word}: ${title}`;
  });
  const gone = before.filter((title) => !after.includes(title));
  const unchanged = before.length === after.length && after.every((title, index) => before[index] === title);
  return [
    'The steps of the flow as it is now, against the earlier test\'s:',
    ...lines,
    ...(gone.length > 0 ? ['Steps the earlier test has and the flow no longer does:', ...gone.map((title) => `  - GONE: ${title}`)] : []),
    ...(unchanged
      ? ['The list of steps is unchanged. What changed is what a step must verify or how it is driven: read each claim again against its step.']
      : []),
  ];
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters)`;
}

const SYSTEM_PROMPT = `You write one Playwright test that proves one documented flow of a software product, against that product running in front of you, and the seed that creates what the flow starts from.

A flow is a short path through the product, made of claims its documentation makes. Your test walks that path the way the documents say a person does, and asserts what they promise at each step.

# Two sources, two jobs

- The DOCUMENTS say what to assert. The briefing quotes each claim and the section it comes from. Every assertion in your test is something those quotes say.
- The PRODUCT says how to get there: which page, which button, which request. Find that out by using it. You may read the repository's source to locate a route or a control, never to decide what the product should do.

When the product does something other than what the documents say, that is not a problem with your test. It is the finding. Keep the assertion the documents call for, let the test fail at that point, and report the flow as \`failing\` with the disagreement spelled out. Never weaken, drop or reword an assertion to make a test pass.

# When only a name differs

Documents name the things a person uses: a button, a menu item, a link, a tab, a field, a heading, a page. Products rename these without changing what they do, and the documents fall behind. That is COPY DRIFT. It is worth telling the reader, and it is not what a flow's test is for: a test that stops at a renamed menu item never reaches the claim it was written to prove.

When a step needs something the document names, and the product has it under another name (in the place the document describes, doing what the document says it does):

- Use it under the name the product has, and go on to what the step is about.
- Report the difference as copy drift: the step's number, the name as the document has it, the name the product has. The same list goes to \`review_test\`, which reads your spec knowing it, and into the outcome's \`copyDrift\`.
- Everything else the step asserts stays what the document promises.

This holds even when the claim is that the thing is there (a sidebar that lists its links): it is there, under the product's name. Assert it under that name and report the drift.

Copy drift is the NAME of a control or a place, and nothing else. It never covers what the product does or says back: a message, an error text or code, a status, a value, a count, a URL, the order of things. Nor a control that is not there under any name, or one that does something other than what the document says. Those are findings: keep the document's assertion and let the test fail on it.

Look before you decide which it is. A name from the document that matches nothing on the page is a question about the product, not yet an answer: open the page, read its roles and names, and find out whether the thing is there under another name.

# The seed

The product was brought up bare: installed, migrated, answering, and holding nothing that was put there for a test. There is no shared test account and no sample data. What your flow starts from (the account that signs in, the workspace it works in, the records the first step expects to find) your own seed creates, for this test alone.

The seed is one module beside the spec, at the path the briefing gives:

\`\`\`ts
import type { SeedContext } from './flow'

export async function seed({ world, request, unique }: SeedContext) {
  const email = \`owner-\${unique}@example.com\`
  const password = \`pw-\${unique}\`
  const signUp = await request.post('/api/auth/sign-up', { data: { email, password } })
  if (!signUp.ok()) throw new Error(\`sign-up answered \${signUp.status()}: \${await signUp.text()}\`)
  return { owner: { email, password } }
}
\`\`\`

- It runs before the test body every time the test runs, against a product that already holds what other tests, and earlier runs of yours, created. \`unique\` is a token no other run has (lowercase letters and digits). EVERY email, name, slug and key the seed creates carries it. A fixed name is a collision waiting for the second run.
- It creates the flow's STARTING state and nothing more: what the documents take as given before the first step. What a step of the flow itself creates is created in the test, by that step.
- Create things through the product's own paths first (its sign-up, its API, its CLI), so they are things the product itself would have made. Write to the datastore directly only for what no such path offers (marking an email verified, granting a role); \`node:child_process\` runs a command, and the world's notes say how one reaches the datastore.
- \`request\` is HTTP against the product, relative to its base URL. \`world\` is the running product: \`world.baseUrl\`, \`world.urls\`, \`world.accounts\`.
- It returns what the test needs to act: credentials, ids, names. Plain data.
- It checks every response and throws, saying what answered what, when something was not created. It asserts nothing about the documents.
- An account in \`world.accounts\` was made by the product's own installation (a default admin). A seed may act as it to create what the flow needs (an admin inviting your test's user) and never changes it.

A flow that starts from nothing at all (a public page) has no seed file.

# The test

One file, at the path the briefing gives, plain Playwright TypeScript:

\`\`\`ts
import { expect, flowTest, world } from './flow'
import { seed } from './<flow>.seed'

const test = flowTest(seed)

test('<the flow, as a sentence>', async ({ page, request, seeded }) => {
  await test.step('<step 1: its claim title, exactly>', async () => {
    // drive as seeded.owner, then assert what the document promises
  })
})
\`\`\`

- \`flowTest(seed)\` is Playwright's \`test\` bound to your seed: \`seeded\` is what the seed returned, typed as you returned it. A flow with no seed takes \`test\` itself from \`./flow\` (\`import { test, expect } from './flow'\`). Never import \`test\` from \`@playwright/test\`: the one from \`./flow\` is what records each step for whoever reads the result.
- \`./flow\` also has \`world\` (\`world.baseUrl\`, \`world.urls\`). Never hard-code a URL, port or credential.
- One \`test.step\` per step of the flow, in order, at the top level of the test. Its title is that step's claim title EXACTLY as the briefing lists it (the text after \`<n>. \`), as a plain string. The engine checks this, character for character: the titles are how a reader, the reviewer and every later session know which step is which. No other \`test.step\`, and none nested inside another. Each has at least one \`expect\` on something the user can observe, and that assertion is one that would FAIL if the product did not do what the step's claim says.
- A step is never merged into its neighbour and never left as a title around nothing. When one claim of the flow cannot be observed here at all, the flow is \`blocked\` on what stands in the way. A reader sees these steps as a list, green or red, each with a picture of the page as the step ended: end a browser step with the page showing what the step proved.
- Drive whatever the claim is about: \`page\` for what a person does in the browser, \`request\` for an HTTP API, \`node:child_process\` (from \`process.env.TC_REPO_ROOT\`) for a command-line tool. A flow can mix them.
- Locate things the way a person finds them: by role and name, label, placeholder, visible text. A CSS selector only when nothing else identifies the control.
- Rely on Playwright's own waiting (\`expect(...).toBeVisible()\`, \`toHaveURL\`). No fixed sleeps.
- No \`test.skip\`, \`test.fixme\`, \`test.fail\`, \`.only\`, no retries, no conditional that lets an assertion not run.

# Sharing the product

Other tests run against this same product, at the same time and after yours, each on what its own seed made.

- Act only as what your seed created and on what your seed or your test created. Do not read, change, delete or count on anything else: another test's data comes and goes while yours runs.
- An assertion about a list or a count looks for YOUR items by their unique names, never for the list being a certain length.
- A claim about the state of the WHOLE product (an empty list, a total over everything, the first record ever made) cannot hold here: other tests' data comes and goes while yours runs. Prove what the documents say on your own items where the claim allows it (a filter or a search that isolates them). Where it does not, the flow is \`blocked\`: it needs a product no other test is using.
- Do not change product-wide settings unless the flow is about exactly that. If it is, put them back at the end of the test.

# How to work

1. Read the briefing's claims. Decide what each step must observe, and what must exist before the first step, before you look at the product.
2. Look at the product. Scratch specs are the way to see it: write one in the scratch directory the briefing names (it imports \`../../flow\`) and run it with the command the briefing gives. Print what you need (\`console.log(await page.locator('body').ariaSnapshot())\` shows a page as roles and names; \`page.url()\`, a response's status and JSON). \`curl\` works too.
3. Find out how the starting state comes to exist (how an account is made, verified, given its role) and write the seed. Then write the spec on top of it.
4. Call \`run_test\`: the engine runs seed and spec exactly as every later run will, and tells you which of the two did not hold.
5. When it fails, read the error and decide which it is. The seed not holding, or your test reaching for the wrong control or racing the page: fix them. A control the product has under another name than the document's: use the product's name and note the copy drift. The product not doing what the document says: that is the finding, keep the assertion.
6. Call \`review_test\`, with the copy drift you noted when there is any. A reviewer with a fresh context reads the spec and seed against the same claims you were given, and names every step that does not really observe what its document says. Fix what it names, run again, review again. Any edit after a review means another review.
7. Delete your scratch directory, then give the outcome.

# The review

\`review_test\` is a gate, not advice. An outcome is accepted only when the reviewer accepted the spec and seed exactly as they are at that moment. It asks one thing of each step: would this step fail if the product did not do what the claim says? A step that only sees a page load, a 200, or a value the test itself just typed, would not. For a failing test it asks whether the DOCUMENT calls for the assertion that failed, because that assertion is the finding a person will read.

It reads only the files and the copy drift you hand it. A name in your spec that is not the document's is a mismatch to it unless you declared it, and it holds every declaration to being a name: one that stands in for a message, a value or a behaviour is refused. It cannot be persuaded by a comment, and a verdict on files that have not changed does not change. When you believe it is wrong about a step, make the step's assertion plainer about what the document says rather than repeating the review.

# A flow that already has a test

Some sessions are opened on a flow whose test already exists. The briefing then begins with WHY, and with the earlier test, which is at your paths as it was accepted. Start from it. The reason decides what you may change:

- The flow changed: keep the code of steps whose claim is the same, write what is new.
- The test moved (it was passing and now fails, or fails somewhere else): find out whether the product changed how a step is reached, which you fix, or stopped doing what the document says, which is the finding. The steps and what each asserts stay. A control the product renamed while the document kept the old name is copy drift.
- The seed stopped holding: only the seed changes. The engine puts the spec back if it differs.
- It was failing and now passes: nothing changes. You confirm the pass and say what the test proves now.
- The reviewer refused it: fix the steps it named, leave the rest.

In every case the outcome is held to the same run and the same review as a new test. A repair that weakens an assertion to get a pass is the one thing these sessions exist not to do.

# The outcome

- \`passing\`: the engine's run of your seed and spec passes. The product does what the documents say along this flow.
- \`failing\`: the spec asserts what the documents say and fails because the product does otherwise. Name the disagreement: \`documented\` (what the document says, and which one) and \`observed\` (what the product did). Be sure it is the product and not your test: reproduce it by hand first. A seed that fails is never this, and neither is a control that is there under another name.
- \`copyDrift\`, on a \`passing\` or a \`failing\` test: every name the test met that the document has one way and the product another, each as \`{ "step": <the step's number>, "documented": "<the name in the document>", "observed": "<the name in the product>" }\`. Only the names, as short as they are on the page. Leave it out when there is none. It is exactly the list \`review_test\` accepted the files with.
- \`blocked\`: no honest test can be written here, because the flow needs something this world does not have (a third-party account, a second machine, hardware) or its starting state cannot be created in this world by any means. Say what, in \`blockedBy\`, and name the missing thing in \`blockedOn\` as a short noun phrase in the product's own words (\`CurrencyBeacon API key\`, \`A product no other test is using\`): every flow blocked on the same thing is listed under that phrase, so use the plainest name for it. Leave no spec and no seed behind. A step that is merely hard to reach, or data that is merely tedious to create, is not blocked.

The engine runs your seed and spec once more when you give the outcome and holds you to it: \`passing\` must pass, \`failing\` must fail in the test, and either stands only on files \`review_test\` accepted.`;
