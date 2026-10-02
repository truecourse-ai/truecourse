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
 * The engine holds the result to its own run of the spec (`run_test`, the same
 * call every later run makes): `passing` must pass, `failing` must fail, and
 * `blocked` leaves no spec behind. A session cannot report a test the engine
 * did not see behave that way.
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
} from '@truecourse/agent-loop';
import { flowTestEnv, runFlowTests } from '@truecourse/guard-runner';
import {
  FlowTestOutcomeSchema,
  type FlowTestOutcome,
  type FlowTestResult,
  type GuardFlow,
  type ProductWorld,
} from '@truecourse/shared';
import { flowTestFileName, flowTestPath, flowTestsDir } from '@truecourse/shared/work-tree';

export const FLOW_TEST_SESSION_KIND = 'guard-generate.flow-test';

export const FLOW_TEST_SESSION_BUDGET = { turns: 80, maxResumes: 1, tokenCeiling: 2_000_000 } as const;

/** One flow's whole wall clock: exploring a few screens, writing, a handful of runs. */
export const FLOW_TEST_SESSION_TIMEOUT_MS = 45 * 60_000;

/** How much of one document section a briefing quotes. */
const SECTION_QUOTE_CHARS = 4_000;

const FLOW_TEST_SESSION = defineSessionKind({
  kind: FLOW_TEST_SESSION_KIND,
  outcomeSchema: FlowTestOutcomeSchema,
});

/** One step of the flow as the briefing shows it: the claim and the text it was read from. */
export interface FlowTestStep {
  order: number;
  claimTitle: string;
  /** The claim as extracted, when the claim corpus has it. */
  claim?: string;
  doc: string;
  anchor: string;
  /** The section the claim lives in, when the document could be read. */
  sectionText?: string;
}

export interface FlowTestSessionInput {
  repoRoot: string;
  flow: GuardFlow;
  steps: readonly FlowTestStep[];
  world: ProductWorld;
  signal?: AbortSignal;
}

/** A session's view of the engine's last run of its spec, for the caller that folds the outcome. */
export interface FlowTestSessionState {
  lastRun(): FlowTestResult | undefined;
}

export function flowTestSessionDef(input: FlowTestSessionInput): {
  def: SessionDef<FlowTestOutcome>;
  state: FlowTestSessionState;
} {
  const file = flowTestFileName(input.flow.id);
  const specPath = flowTestPath(input.repoRoot, input.flow.id);
  const specRel = path.relative(input.repoRoot, specPath);
  let lastRun: FlowTestResult | undefined;

  const runSpec = async (signal?: AbortSignal): Promise<{ ok: true; result: FlowTestResult } | { ok: false; reason: string }> => {
    lastRun = undefined;
    if (!fs.existsSync(specPath)) return { ok: false, reason: `There is no spec at ${specRel} yet.` };
    const defect = specDefect(fs.readFileSync(specPath, 'utf-8'));
    if (defect) return { ok: false, reason: defect };
    const run = await runFlowTests(input.repoRoot, {
      world: input.world,
      tests: [{ flowId: input.flow.id, file }],
      workers: 1,
      label: input.flow.id,
      ...(signal ? { signal } : {}),
    });
    if (!run.ok) return run;
    lastRun = run.results[0];
    return { ok: true, result: run.results[0] };
  };

  const def: SessionDef<FlowTestOutcome> = {
    ...FLOW_TEST_SESSION,
    reasoning: 'high',
    display: {
      title: 'Flow test',
      intro: `I'm writing the Playwright test for "${input.flow.title}" against the running product.`,
    },
    systemPrompt: SYSTEM_PROMPT,
    computer: {
      cwd: input.repoRoot,
      tools: COMPUTER_TOOLS,
      env: flowTestEnv(input.repoRoot, input.world),
    },
    tools: [runTestTool(specRel, runSpec)],
    budget: FLOW_TEST_SESSION_BUDGET,
    // The gate of record: the engine's own run of the spec as it stands, held
    // against what the session says it proves.
    async validateOutcome(outcome) {
      if (outcome.status === 'blocked') {
        return fs.existsSync(specPath)
          ? `Outcome refused: a blocked flow has no test, but ${specRel} exists. Delete it, or finish it and report what it proves.`
          : undefined;
      }
      const run = await runSpec(input.signal);
      if (!run.ok) return `Outcome refused: ${run.reason}`;
      const { result } = run;
      if (outcome.status === 'passing' && result.outcome !== 'pass') {
        return `Outcome refused: you reported the test passing, and the engine's run of it ended ${result.outcome}:\n\n${result.error ?? '(no error text)'}\n\nIf the product really does something other than what the documents say, the status is \`failing\` with the disagreement named. Otherwise fix the test.`;
      }
      if (outcome.status === 'failing' && result.outcome !== 'fail') {
        return `Outcome refused: you reported the test failing on a disagreement, and the engine's run of it ended ${result.outcome}. A test that passes is \`passing\`.`;
      }
      return undefined;
    },
  };
  return { def, state: { lastRun: () => lastRun } };
}

/**
 * What a spec may not contain, as the reason it is refused. These are the
 * ways a test stops meaning what its result says: skipped, expected to fail,
 * or narrowed to part of itself.
 */
function specDefect(source: string): string | undefined {
  if (!/from ['"]@playwright\/test['"]/.test(source)) return 'The spec does not import from `@playwright/test`.';
  if (!/\bexpect\s*[.(]/.test(source)) return 'The spec asserts nothing: it has no `expect`.';
  const banned = source.match(/\b(?:test|it|describe)\.(?:skip|fixme|fail|only)\b|\.describe\.(?:skip|fixme|only)\b/);
  if (banned) {
    return `The spec uses \`${banned[0]}\`. A test here runs whole and means what its result says: no skip, fixme, fail or only.`;
  }
  return undefined;
}

const RUN_TEST = defineToolSpec({
  name: 'run_test',
  description:
    "The engine runs THIS flow's spec against the running product, exactly as every later run will, and returns whether it passed with the failing assertion when it did not. It is the check your outcome is held to.",
  kind: 'run-flow-test',
  readOnly: false,
  destructive: false,
  inputSchema: z.object({}).strict(),
});

function runTestTool(
  specRel: string,
  runSpec: (signal?: AbortSignal) => Promise<{ ok: true; result: FlowTestResult } | { ok: false; reason: string }>,
): SessionTool {
  return RUN_TEST.bind({
    async execute(_args, ctx) {
      const run = await runSpec(ctx.signal);
      if (!run.ok) return { content: run.reason, isError: true };
      const { result } = run;
      const seconds = (result.durationMs / 1000).toFixed(1);
      if (result.outcome === 'pass') return { content: `PASSED in ${seconds}s: ${specRel}` };
      const trace = result.attachments.find((a) => a.name === 'trace');
      return {
        content: [
          `${result.outcome === 'skipped' ? 'SKIPPED' : 'FAILED'} in ${seconds}s: ${specRel}`,
          '',
          result.error ?? '(no error text)',
          ...(trace ? ['', `trace: ${trace.path}`] : []),
        ].join('\n'),
        isError: true,
      };
    },
  });
}

export function flowTestBriefing(input: FlowTestSessionInput): string {
  const { flow, world } = input;
  const file = flowTestFileName(flow.id);
  const testsRel = path.relative(input.repoRoot, flowTestsDir(input.repoRoot));
  const scratch = file.replace(/\.spec\.ts$/, '');
  const steps = input.steps.flatMap((step) => [
    `${step.order}. ${step.claimTitle}`,
    ...(step.claim ? [`   claim: ${step.claim}`] : []),
    `   document: ${step.doc} § ${step.anchor}`,
    ...(step.sectionText
      ? ['   the section, as written:', ...clip(step.sectionText, SECTION_QUOTE_CHARS).split('\n').map((line) => `   | ${line}`)]
      : []),
    '',
  ]);
  const starting = flow.startingState
    ? [...flow.startingState.seedable, ...flow.startingState.stepCreatable, ...flow.startingState.supplied]
    : [];
  return [
    `Write the test for ONE flow: "${flow.title}" (${flow.id}).`,
    `Goal: ${flow.goal}`,
    ...(flow.notes ? [`Notes from whoever composed the flow: ${flow.notes}`] : []),
    ...(starting.length > 0 ? [`It starts from a world that has: ${starting.join('; ')}`] : []),
    '',
    'The path, in order. Each step is something the documents say the product does:',
    '',
    ...steps,
    'The running product:',
    `- baseUrl: ${world.baseUrl} (Playwright's \`baseURL\`, so \`page.goto('/')\` opens it)`,
    ...Object.entries(world.urls).map(([name, url]) => `- urls.${name}: ${url}`),
    ...world.accounts.map(
      (a) => `- account "${a.name}"${a.role ? `: ${a.role}` : ''}${a.token ? ' (has an API token)' : ''}${a.notes ? `. ${a.notes}` : ''}`,
    ),
    ...(world.notes ? [`- notes: ${world.notes}`] : []),
    '',
    `The repository root is your working directory: ${input.repoRoot}`,
    `The tests directory: ${testsRel}`,
    `Your spec: ${path.join(testsRel, file)}`,
    `Your scratch directory: ${path.join(testsRel, 'scratch', scratch)}/`,
    `To run a scratch spec: cd ${testsRel} && node node_modules/@playwright/test/cli.js test scratch/${scratch}/<file>.spec.ts --reporter=line`,
  ].join('\n');
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters in the document)`;
}

const SYSTEM_PROMPT = `You write one Playwright test that proves one documented flow of a software product, against that product running in front of you.

A flow is a short path through the product, made of claims its documentation makes. Your test walks that path the way the documents say a person does, and asserts what they promise at each step.

# Two sources, two jobs

- The DOCUMENTS say what to assert. The briefing quotes each claim and the section it comes from. Every assertion in your test is something those quotes say.
- The PRODUCT says how to get there: which page, which button, which request. Find that out by using it. You may read the repository's source to locate a route or a control, never to decide what the product should do.

When the product does something other than what the documents say, that is not a problem with your test. It is the finding. Keep the assertion the documents call for, let the test fail at that point, and report the flow as \`failing\` with the disagreement spelled out. Never weaken, drop or reword an assertion to make a test pass.

# The test

One file, at the path the briefing gives, plain \`@playwright/test\` TypeScript:

\`\`\`ts
import { test, expect } from '@playwright/test'
import { world, account } from './world'

test('<the flow, as a sentence>', async ({ page, request }) => {
  await test.step('<step 1, in the document\\'s words>', async () => {
    // drive, then assert what the document promises
  })
})
\`\`\`

- \`./world\` describes the running product: \`world.baseUrl\`, \`world.urls\`, and \`account('<name>')\` for a seeded account's \`email\`, \`username\`, \`password\`, \`token\`. Never hard-code a URL, port or credential.
- One \`test.step\` per step of the flow, in order, named by what the document claims. Each has at least one \`expect\` on something the user can observe.
- Drive whatever the claim is about: \`page\` for what a person does in the browser, \`request\` for an HTTP API, \`node:child_process\` (from \`process.env.TC_REPO_ROOT\`) for a command-line tool. A flow can mix them.
- Locate things the way a person finds them: by role and name, label, placeholder, visible text. A CSS selector only when nothing else identifies the control.
- Rely on Playwright's own waiting (\`expect(...).toBeVisible()\`, \`toHaveURL\`). No fixed sleeps.
- No \`test.skip\`, \`test.fixme\`, \`test.fail\`, \`.only\`, no retries, no conditional that lets an assertion not run.

# Sharing the product

Other tests run against this same product, at the same time and after yours.

- Create the data your flow needs inside the test, with names no other test will pick (suffix them with \`Date.now()\`).
- Sign in as a seeded account; do not change its password, email, role or anything else another test relies on. A flow about changing those needs an account of its own: create one through the product (sign up) inside the test.
- Do not delete or rename what you did not create, and do not change product-wide settings unless the flow is about exactly that. If it is, put them back at the end of the test.

# How to work

1. Read the briefing's claims. Decide what each step must observe before you look at the product.
2. Look at the product. Scratch specs are the way to see it: write one in the scratch directory the briefing names and run it with the command the briefing gives. Print what you need (\`console.log(await page.locator('body').ariaSnapshot())\` shows a page as roles and names; \`page.url()\`, a response's status and JSON). \`curl\` works too.
3. Write the spec. Call \`run_test\`: the engine runs it exactly as every later run will.
4. When it fails, read the error and decide which it is. Your test reaching for the wrong control or racing the page: fix the test. The product not doing what the document says: that is the finding, keep the assertion.
5. Delete your scratch directory, then give the outcome.

# The outcome

- \`passing\`: the engine's run of your spec passes. The product does what the documents say along this flow.
- \`failing\`: the spec asserts what the documents say and fails because the product does otherwise. Name the disagreement: \`documented\` (what the document says, and which one) and \`observed\` (what the product did). Be sure it is the product and not your test: reproduce it by hand first.
- \`blocked\`: no honest test can be written here, because the flow needs something this world does not have (a third-party account, a second machine, hardware). Say what, in \`blockedBy\`, and leave no spec file behind. A step that is merely hard to reach is not blocked.

The engine runs your spec once more when you give the outcome and holds you to it: \`passing\` must pass, \`failing\` must fail.`;
