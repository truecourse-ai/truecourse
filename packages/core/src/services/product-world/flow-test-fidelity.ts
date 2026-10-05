/**
 * THE FLOW-TEST FIDELITY JUDGE — `guard-generate.flow-test-fidelity`.
 *
 * A session with a fresh context reads one flow's spec and seed against the
 * claims the flow is made of, and answers whether each step observes what its
 * document promises. It is given the claims exactly as the test's author was
 * (`flow-test-steps.ts`), the files, and how each step went in the engine's
 * last run of them. It has no shell, no product and nothing of the author's
 * reasoning, which is the independence: the same model, by decision, with none
 * of what talked the author into the test.
 *
 * It is a GATE. A flow-test session's outcome is accepted only under a
 * `faithful` verdict on the files as they stand (`review_test` dispatches this
 * judge as a child), and a kept test is judged again whenever what the verdict
 * was given over has changed. That is the KEY: named inputs, hashed. The stage
 * version, the spec, the seed, and per step the claim title, the extracted
 * claim and the section text as quoted. A document edit that leaves the flow
 * itself alone still changes the key, so the kept test is read against the new
 * words.
 *
 * For a `failing` test the judge reads the failing assertion against the
 * document: that assertion is the finding a person will read.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { defineSessionKind, type SessionBudget, type SessionDef, type SessionOutcome } from '@truecourse/agent-loop';
import type { FlowTestStep as FlowTestStepRun, GuardFlow } from '@truecourse/shared';
import { describeSessionFailure } from '../guard-setup/session-context.js';
import { flowStepQuotes, quotedSection, type FlowTestStep } from './flow-test-steps.js';

export const FLOW_TEST_FIDELITY_SESSION_KIND = 'guard-generate.flow-test-fidelity';

/**
 * THE JUDGE'S VERSION, bumped by hand. Rewording the prompt does not make a
 * judged test unfaithful; a prompt change that fixes WRONG verdicts bumps this
 * in the same commit, and every kept test is judged again.
 */
export const FLOW_TEST_FIDELITY_STAGE_VERSION = 1;

/** The briefing carries everything, so the turns are for the verdict and one correction of it. */
export const FLOW_TEST_FIDELITY_BUDGET: SessionBudget = { turns: 4, maxResumes: 0, tokenCeiling: 200_000 };

/**
 * One object discriminated by `verdict`, and not a union: the drivers hand
 * this schema to provider surfaces that need an object at the root. The
 * pairing is enforced by the refinement.
 */
export const FlowTestFidelityVerdictSchema = z
  .object({
    verdict: z.enum(['faithful', 'flagged']),
    /** flagged: one entry per step the spec fails on, by the step's number in the briefing. */
    flagged: z
      .array(
        z
          .object({
            step: z.number().int().positive(),
            /** One sentence: what the step fails to observe. */
            mismatch: z.string().min(1),
          })
          .strict(),
      )
      .optional(),
    /** Required with `flagged`; a faithful verdict may carry it too. */
    confidence: z.enum(['high', 'medium', 'low']).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.verdict === 'flagged') {
      if (!value.flagged?.length) {
        ctx.addIssue({ code: 'custom', path: ['flagged'], message: 'verdict "flagged" names at least one step and its mismatch' });
      }
      if (value.confidence === undefined) {
        ctx.addIssue({ code: 'custom', path: ['confidence'], message: 'verdict "flagged" requires `confidence`' });
      }
    } else if (value.flagged?.length) {
      ctx.addIssue({ code: 'custom', path: ['flagged'], message: 'verdict "faithful" must not carry flagged steps' });
    }
  });
export type FlowTestFidelityOutcome = z.infer<typeof FlowTestFidelityVerdictSchema>;

const FLOW_TEST_FIDELITY_SESSION = defineSessionKind({
  kind: FLOW_TEST_FIDELITY_SESSION_KIND,
  outcomeSchema: FlowTestFidelityVerdictSchema,
});

/** One step the judge refused, and why. */
export interface FlowTestFlaggedStep {
  step: number;
  mismatch: string;
}

/**
 * What a judgment came to. `unavailable` is a fact about one dispatch (the
 * judge ran out of budget, or the provider failed): it is no verdict, and
 * whoever asked asks again.
 */
export type FlowTestVerdict =
  | { kind: 'faithful' }
  | { kind: 'flagged'; flagged: FlowTestFlaggedStep[]; confidence: 'high' | 'medium' | 'low' }
  | { kind: 'unavailable'; reason: string };

/** What the judge is shown of one test. */
export interface FlowTestFidelityInput {
  flow: Pick<GuardFlow, 'id' | 'title' | 'goal'>;
  steps: readonly FlowTestStep[];
  spec: string;
  /** The seed's source, for a test that has one. */
  seed?: string;
  /** The engine's last run of these files: how it ended, and how each step went. */
  run: { outcome: 'pass' | 'fail'; steps: readonly FlowTestStepRun[]; error?: string };
}

/**
 * The key a verdict is given under. Named inputs: the stage version, the spec,
 * the seed, and per step the claim title, the extracted claim and the section
 * text as quoted. How the last run went is not one of them: it is what the
 * files do, and the files are.
 */
export function flowTestJudgeKey(input: Pick<FlowTestFidelityInput, 'steps' | 'spec' | 'seed'>): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        `flow-test-fidelity-v${FLOW_TEST_FIDELITY_STAGE_VERSION}`,
        input.spec,
        input.seed ?? null,
        input.steps.map((step) => [step.order, step.claimTitle, step.claim ?? null, quotedSection(step) ?? null]),
      ]),
    )
    .digest('hex');
}

export function flowTestFidelityDef(input: Pick<FlowTestFidelityInput, 'steps'>): SessionDef<FlowTestFidelityOutcome> {
  const orders = new Set(input.steps.map((step) => step.order));
  return {
    ...FLOW_TEST_FIDELITY_SESSION,
    display: { title: 'Test fidelity check' },
    systemPrompt: SYSTEM_PROMPT,
    tools: [],
    budget: FLOW_TEST_FIDELITY_BUDGET,
    validateOutcome(outcome) {
      const unknown = (outcome.flagged ?? []).map((f) => f.step).filter((step) => !orders.has(step));
      return unknown.length > 0
        ? `Outcome refused: the flow has no step ${unknown.join(', ')}. Flag steps by the numbers the briefing lists them under (${[...orders].join(', ')}).`
        : undefined;
    },
  };
}

export function flowTestFidelityBriefing(input: FlowTestFidelityInput): string {
  const went = new Map(input.run.steps.map((step) => [step.order, step]));
  const runLines = input.steps.map((step, index) => {
    const ran = went.get(index + 1);
    const how = !ran || ran.outcome === 'not-reached' ? 'not reached' : ran.outcome === 'passed' ? 'passed' : 'FAILED';
    return `${step.order}. ${how}${ran?.error ? `\n${indent(ran.error)}` : ''}`;
  });
  return [
    `Judge the test of ONE flow: "${input.flow.title}" (${input.flow.id}).`,
    `Goal: ${input.flow.goal}`,
    '',
    'The steps, in order. Each is something the documents say the product does:',
    '',
    ...flowStepQuotes(input.steps),
    'The spec:',
    '```ts',
    input.spec.trimEnd(),
    '```',
    '',
    ...(input.seed !== undefined ? ['The seed it starts from:', '```ts', input.seed.trimEnd(), '```', ''] : ['The test has no seed: it starts from nothing.', '']),
    input.run.outcome === 'pass'
      ? "The engine's last run of these files PASSED. Each step:"
      : "The engine's last run of these files FAILED, and the test is kept as a finding: the product is said to do something other than what the documents say. Each step:",
    ...runLines,
    ...(input.run.outcome === 'fail' && input.run.error && !input.run.steps.some((step) => step.error)
      ? ['', 'The error:', indent(input.run.error)]
      : []),
  ].join('\n');
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((line) => `   | ${line}`)
    .join('\n');
}

/** A judge session's outcome as the verdict it is, with what the session spent. */
export function flowTestVerdictOf(outcome: SessionOutcome<FlowTestFidelityOutcome>): FlowTestVerdict {
  if (outcome.status !== 'completed') return { kind: 'unavailable', reason: describeSessionFailure(outcome.failure) };
  const parsed = FlowTestFidelityVerdictSchema.safeParse(outcome.output);
  if (!parsed.success) return { kind: 'unavailable', reason: `malformed verdict: ${parsed.error.message}` };
  return parsed.data.verdict === 'faithful'
    ? { kind: 'faithful' }
    : { kind: 'flagged', flagged: parsed.data.flagged ?? [], confidence: parsed.data.confidence ?? 'medium' };
}

/** A flagged verdict as one line per step, for whoever has to act on it or count it. */
export function describeFlagged(flagged: readonly FlowTestFlaggedStep[]): string {
  return flagged.map((f) => `step ${f.step}: ${f.mismatch}`).join('; ');
}

const SYSTEM_PROMPT = `You judge one Playwright test against the documentation it was written from.

The test proves one FLOW of a software product: a short path made of claims the product's documents make. Someone else wrote the test, with the product running in front of them. You see none of their reasoning and you cannot run anything. You are given the claims, the test's spec and seed, and how the engine's last run of them went. Your one question is whether the test really observes what the documents promise.

# What a faithful test is

For EVERY step of the flow:

- The spec has a top-level \`test.step\` titled with that step's claim title, and inside it at least one \`expect\` on something a user of the product can observe (what a page shows, what a response carries, what a command prints).
- That assertion would FAIL if the product did not do what the claim says. This is the whole test of an assertion. One that holds whether or not the claim is true observes nothing: a page merely loading, a status of 200 on a request whose result is what the claim is about, an element that is there before the step acts, a value the test itself just typed read back from the same input.
- The step reaches its assertion by using the product the way the claim describes. A step that writes to the datastore, or calls an internal endpoint, to produce the very state the claim says the product produces has proven nothing about the product.
- The assertion is about what THIS step claims. An assertion belonging to a neighbouring step does not cover this one.

And for the seed, when there is one: it creates what the flow STARTS from and nothing a step of the flow claims the product does. A seed that performs a step's action, so that the step only looks at the result, has taken the proof out of the test.

# What is not your concern

- How a control is located, how the test waits, its style, its length. The engine ran it; it works.
- Whether the product is right. You never judge the product, only whether the test would notice.
- A claim narrower than you would have written it. Hold the step to what its claim and its section say, not to everything the document says elsewhere.
- An assertion on the test's own uniquely named data where the document speaks of "the list" or "a record". Other tests share the product, so that is how such a claim is proven here.

Be strict about assertions that cannot fail and lenient about everything else. A flag sends the author back to work, or costs the flow its test: flag what a careful reviewer would refuse to merge, and say exactly what is not observed.

# A failing test

When the last run FAILED, the test is kept as a FINDING: the claim is that the product does something other than what its documents say. A person will read that finding and act on it. So judge the failing step hardest:

- The assertion that failed must be one the DOCUMENT calls for. Read the quoted section. If the document does not promise what the assertion demands (the test expects a button label, a message or a behaviour the section never states), the finding is the test's invention: flag that step.
- The failure must be the assertion's. An error that is the test not finding its way (a locator that matches nothing on the way to the assertion, a navigation that timed out, a step that never reached its \`expect\`) is not a disagreement between product and document: flag that step.
- Steps after the failing one were not reached. Judge them from the code alone.

# The outcome

  { "verdict": "faithful" }
or
  { "verdict": "flagged", "flagged": [{ "step": 2, "mismatch": "<one sentence: what this step fails to observe>" }], "confidence": "high" | "medium" | "low" }

One entry per step you refuse, by the number the briefing lists the step under. A defect of the seed is flagged on the step whose proof it takes away. Each mismatch is one sentence that names the missing observation precisely enough to act on ("asserts only that the dialog closed, never that the invitation appears in the members list"), never general advice.`;
