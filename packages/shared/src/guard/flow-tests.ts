/**
 * FLOW TESTS — one Playwright test per synthesized flow, written by a session
 * that had the running product in front of it.
 *
 * The test is plain `@playwright/test` TypeScript: it drives the product the
 * way the flow's documents say a person does, through the browser, over HTTP
 * or by running a command, and asserts what those documents promise. What it
 * asserts comes from the documents; the product is only where the session
 * finds out how to reach each step.
 *
 * The product is brought up bare (`world.ts`), so a test that starts from
 * anything (an account, a project, a record) has a SEED: a module beside the
 * spec whose one function creates that starting state, uniquely named, each
 * time the test runs. Seed and spec are written together, proven together and
 * stored together, and no test reads what another's seed made. A seed that
 * does not hold is the test's own defect and never a finding.
 *
 * A test is kept in one of two states. `passing`: the product does what the
 * documents say. `failing`: the test asserts what the documents say, the
 * product does something else, and the test fails at exactly that point, which
 * is the finding. A flow nobody could write a test for is `blocked`, and says
 * what stood in the way.
 *
 * A name is not a finding. Where the documents call a control one thing and
 * the product another, the test uses the product's name, goes on to what the
 * flow is about, and carries the difference as COPY DRIFT.
 *
 * A kept test is run again at every commit its repository generates on. One
 * that still behaves the way it was accepted HOLDS. One that does not has
 * MOVED, and is opened again by a session that is told why
 * (`FLOW_TEST_REPAIR_REASONS`). And every kept spec was read against its
 * claims by a judge that saw nothing of how it was written: `judged` is the
 * key that verdict was given under, so a spec, a seed or a document that
 * changed since is read again.
 */

import { z } from 'zod';

export const FLOW_TEST_STATUSES = ['passing', 'failing', 'blocked'] as const;
export const FlowTestStatusSchema = z.enum(FLOW_TEST_STATUSES);
export type FlowTestStatus = z.infer<typeof FlowTestStatusSchema>;

/** Where the documents and the product part ways, in a `failing` test. */
export const FlowTestDisagreementSchema = z.object({
  /** What the documents say happens, with the document it comes from. */
  documented: z.string().min(1),
  /** What the product did instead. */
  observed: z.string().min(1),
});
export type FlowTestDisagreement = z.infer<typeof FlowTestDisagreementSchema>;

/**
 * COPY DRIFT: a control or a place the documents name one way and the product
 * another, where the product still does what the step claims. The test uses
 * the product's name and goes on to the claim, and the difference is kept here
 * for a reader. It is a mark on a `passing` or a `failing` test and never a
 * status of its own: a test that met a renamed button can still fail on
 * something the product does.
 */
export const FlowTestCopyDriftSchema = z.object({
  /** The 1-based order of the step the name was met in. */
  step: z.number().int().positive(),
  /** The name as the document has it. */
  documented: z.string().min(1),
  /** The name the product has. */
  observed: z.string().min(1),
});
export type FlowTestCopyDrift = z.infer<typeof FlowTestCopyDriftSchema>;

/** A copy drift list in the one order it is stored and keyed in: by step, then by the documented name. */
export function orderCopyDrift(drift: readonly FlowTestCopyDrift[]): FlowTestCopyDrift[] {
  return [...drift].sort((a, b) => a.step - b.step || a.documented.localeCompare(b.documented) || a.observed.localeCompare(b.observed));
}

/** How a flow-test session ends. */
export const FlowTestOutcomeSchema = z
  .object({
    status: FlowTestStatusSchema,
    /** What the test does and what it proves, in two or three sentences. */
    summary: z.string().min(1),
    /** Required when `failing`. */
    disagreement: FlowTestDisagreementSchema.optional(),
    /** Required when `blocked`: the one thing that stood in the way. */
    blockedBy: z.string().min(1).optional(),
    /**
     * Required when `blocked`: the missing thing as a short noun phrase
     * (`CurrencyBeacon API key`). Flows blocked on the same thing say the same
     * phrase, which is what a reader groups them by.
     */
    blockedOn: z.string().min(1).optional(),
    /** Every name the test met that the documents have one way and the product another. */
    copyDrift: z.array(FlowTestCopyDriftSchema).optional(),
  })
  .superRefine((outcome, ctx) => {
    if (outcome.status === 'blocked' && outcome.copyDrift?.length) {
      ctx.addIssue({ code: 'custom', path: ['copyDrift'], message: 'a blocked flow has no test, so it met no copy drift' });
    }
    if (outcome.status === 'failing' && !outcome.disagreement) {
      ctx.addIssue({ code: 'custom', path: ['disagreement'], message: 'a failing test names the disagreement it fails on' });
    }
    if (outcome.status === 'blocked' && !outcome.blockedBy) {
      ctx.addIssue({ code: 'custom', path: ['blockedBy'], message: 'a blocked flow says what blocked it' });
    }
    if (outcome.status === 'blocked' && !outcome.blockedOn) {
      ctx.addIssue({ code: 'custom', path: ['blockedOn'], message: 'a blocked flow names the missing thing in a few words' });
    }
  });
export type FlowTestOutcome = z.infer<typeof FlowTestOutcomeSchema>;

/** One `test.step` of a spec, as one run of it went. */
export const FlowTestStepSchema = z.object({
  /** 1-based position among the spec's top-level steps. */
  order: z.number().int().positive(),
  title: z.string(),
  /** `not-reached`: an earlier step failed, so this one never started. */
  outcome: z.enum(['passed', 'failed', 'not-reached']),
  durationMs: z.number().nonnegative().optional(),
  /** What the failing assertion said. */
  error: z.string().optional(),
});
export type FlowTestStep = z.infer<typeof FlowTestStepSchema>;

/** One execution of one flow's test. */
export const FlowTestResultSchema = z.object({
  flowId: z.string().min(1),
  /** The spec's file name inside the tests directory. */
  file: z.string().min(1),
  /**
   * `seed-failed`: the flow's seed threw or ran out of time, so the test never
   * started. It says nothing about the product.
   */
  outcome: z.enum(['pass', 'fail', 'seed-failed', 'skipped']),
  durationMs: z.number().nonnegative(),
  /** The failing assertion or error, as Playwright printed it. */
  error: z.string().optional(),
  /** The spec's top-level steps that started, in order. A step never reached is not here. */
  steps: z.array(FlowTestStepSchema).default([]),
  /**
   * Tree-relative paths of what the run recorded: the trace, the video, and one
   * `step-<n>` screenshot per browser step, taken as the step ended.
   */
  attachments: z.array(z.object({ name: z.string(), path: z.string() })).default([]),
});
export type FlowTestResult = z.infer<typeof FlowTestResultSchema>;

/**
 * The run a test's status stands on: how each step went, and where its
 * pictures are. `evidencePath` is a guard evidence directory holding one
 * `step-<n>.png` per browser step and the session video; absent when the run
 * drove no browser.
 */
export const FlowTestRunSchema = z.object({
  ranAt: z.string(),
  durationMs: z.number().nonnegative(),
  /** Every top-level step of the spec, the ones never reached included. */
  steps: z.array(FlowTestStepSchema),
  error: z.string().optional(),
  evidencePath: z.string().optional(),
  /** The commit the run was on. On a record's run, the commit its status was accepted on. */
  commit: z.string().optional(),
});
export type FlowTestRun = z.infer<typeof FlowTestRunSchema>;

/**
 * One flow's test as a run of the stored tests went, beside the status
 * authoring accepted it on. The record in `tests/tests.json` is never touched
 * by such a run: this is the run's own account, kept on the run.
 */
export const FlowTestRunResultSchema = z.object({
  flowId: z.string().min(1),
  /** The spec's file name inside the tests directory. */
  file: z.string().min(1),
  /** The status the test was accepted on when it was written. */
  authored: FlowTestStatusSchema.exclude(['blocked']),
  outcome: FlowTestResultSchema.shape.outcome,
  run: FlowTestRunSchema,
});
export type FlowTestRunResult = z.infer<typeof FlowTestRunResultSchema>;

/** What a run of the stored tests came to, and where it parted from authoring. */
export interface FlowTestRunTally {
  /** Tests run. */
  run: number;
  passed: number;
  failed: number;
  seedFailed: number;
  skipped: number;
  /** Accepted as `passing`, and failed this run. */
  nowFailing: number;
  /** Accepted as `failing`, and passed this run. */
  nowPassing: number;
}

/**
 * Count a run's results. A seed that did not hold says nothing about the
 * product, so it moves neither change count.
 */
export function tallyFlowTestRun(results: readonly FlowTestRunResult[]): FlowTestRunTally {
  const count = (pick: (r: FlowTestRunResult) => boolean): number => results.filter(pick).length;
  return {
    run: results.length,
    passed: count((r) => r.outcome === 'pass'),
    failed: count((r) => r.outcome === 'fail'),
    seedFailed: count((r) => r.outcome === 'seed-failed'),
    skipped: count((r) => r.outcome === 'skipped'),
    nowFailing: count((r) => r.authored === 'passing' && r.outcome === 'fail'),
    nowPassing: count((r) => r.authored === 'failing' && r.outcome === 'pass'),
  };
}

/**
 * Why a flow that already has a test gets a session again.
 *   flow-changed   the flow is the same id with a new fingerprint
 *   moved          the test no longer ends the way it was accepted
 *   seed-failed    the seed no longer holds, so the test never starts
 *   now-passing    it was accepted failing on a disagreement, and passes
 *   judge-flagged  the judge read the kept spec and refused it
 */
export const FLOW_TEST_REPAIR_REASONS = ['flow-changed', 'moved', 'seed-failed', 'now-passing', 'judge-flagged'] as const;
export type FlowTestRepairReason = (typeof FLOW_TEST_REPAIR_REASONS)[number];

/** The 1-based order of the step a run failed at, when it failed inside one. */
export function flowTestFailedStep(steps: readonly FlowTestStep[]): number | undefined {
  return steps.find((step) => step.outcome === 'failed')?.order;
}

/**
 * How a kept test's run at a new commit stands against the run its status was
 * accepted on: `holds` when a passing test passes, or a failing one fails at
 * the same step. Anything else moved, and the word says which way.
 */
export function flowTestMovement(
  record: Pick<FlowTestRecord, 'status' | 'run'>,
  rerun: Pick<FlowTestResult, 'outcome' | 'steps'>,
): 'holds' | Exclude<FlowTestRepairReason, 'flow-changed' | 'judge-flagged'> {
  if (rerun.outcome === 'seed-failed') return 'seed-failed';
  if (record.status === 'passing') return rerun.outcome === 'pass' ? 'holds' : 'moved';
  if (rerun.outcome === 'pass') return 'now-passing';
  if (rerun.outcome !== 'fail') return 'moved';
  return flowTestFailedStep(rerun.steps) === flowTestFailedStep(record.run?.steps ?? []) ? 'holds' : 'moved';
}

/**
 * What an error says once everything particular to one run of one test is
 * taken out of it (the unique names a seed made, ids, numbers, paths, timings):
 * its first line, normalized. Tests one change moved the same way share it.
 */
export function flowTestErrorSignature(error: string | undefined): string {
  const line = (error ?? '').split('\n').map((l) => l.trim()).find((l) => l.length > 0) ?? '';
  return (
    line
      .replace(/https?:\/\/[^\s'"`)]+/g, '<url>')
      .replace(/(['"`])(?:(?!\1).)*\1/g, '<text>')
      .replace(/\b[0-9a-f]{8,}\b/gi, '<id>')
      .replace(/\d+(?:\.\d+)?/g, '<n>')
      .replace(/\s+/g, ' ')
      .slice(0, 160) || '(no error text)'
  );
}

/** One flow's entry in `tests/tests.json`. */
export const FlowTestRecordSchema = z.object({
  flowId: z.string().min(1),
  /** The flow as it was when the test was written; a different one is stale. */
  flowFingerprint: z.string().min(1),
  status: FlowTestStatusSchema,
  /** The spec's file name; absent for a `blocked` flow, which has none. */
  file: z.string().min(1).optional(),
  /** The seed's file name, for a test that starts from data of its own. */
  seed: z.string().min(1).optional(),
  summary: z.string().min(1),
  disagreement: FlowTestDisagreementSchema.optional(),
  blockedBy: z.string().min(1).optional(),
  blockedOn: z.string().min(1).optional(),
  /** The copy drift the test was accepted with, in {@link orderCopyDrift}'s order. Absent when it met none. */
  copyDrift: z.array(FlowTestCopyDriftSchema).optional(),
  /** The engine's run the status was accepted on. Absent on a `blocked` flow. */
  run: FlowTestRunSchema.optional(),
  /**
   * The judge key the spec was accepted under: over the spec, the seed, what
   * each step's document says and the copy drift. Absent on a test nobody has judged yet,
   * which is judged at the next generate and is not stale for it.
   */
  judged: z.string().min(1).optional(),
});
export type FlowTestRecord = z.infer<typeof FlowTestRecordSchema>;

export const FlowTestsFileSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  tests: z.array(FlowTestRecordSchema),
});
export type FlowTestsFile = z.infer<typeof FlowTestsFileSchema>;
