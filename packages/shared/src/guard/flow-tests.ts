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
  })
  .superRefine((outcome, ctx) => {
    if (outcome.status === 'failing' && !outcome.disagreement) {
      ctx.addIssue({ code: 'custom', path: ['disagreement'], message: 'a failing test names the disagreement it fails on' });
    }
    if (outcome.status === 'blocked' && !outcome.blockedBy) {
      ctx.addIssue({ code: 'custom', path: ['blockedBy'], message: 'a blocked flow says what blocked it' });
    }
  });
export type FlowTestOutcome = z.infer<typeof FlowTestOutcomeSchema>;

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
  /** Tree-relative paths of what the run recorded (trace, video, screenshots). */
  attachments: z.array(z.object({ name: z.string(), path: z.string() })).default([]),
});
export type FlowTestResult = z.infer<typeof FlowTestResultSchema>;

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
});
export type FlowTestRecord = z.infer<typeof FlowTestRecordSchema>;

export const FlowTestsFileSchema = z.object({
  version: z.literal(1),
  generatedAt: z.string(),
  tests: z.array(FlowTestRecordSchema),
});
export type FlowTestsFile = z.infer<typeof FlowTestsFileSchema>;
