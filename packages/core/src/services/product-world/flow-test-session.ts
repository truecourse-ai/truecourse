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
 * The engine holds the result to its own run of seed and spec together
 * (`run_test`, the same call every later run makes): `passing` must pass,
 * `failing` must fail in the test and never in the seed, and `blocked` leaves
 * neither file behind. A session cannot report a test the engine did not see
 * behave that way.
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
import { FLOW_TEST_ENV, flowTestEnv, runFlowTests, type FlowTestWorld } from '@truecourse/guard-runner';
import { FlowTestOutcomeSchema, type FlowTestOutcome, type FlowTestResult, type GuardFlow } from '@truecourse/shared';
import {
  flowSeedFileName,
  flowSeedPath,
  flowTestFileName,
  flowTestPath,
  flowTestsDir,
} from '@truecourse/shared/work-tree';

export const FLOW_TEST_SESSION_KIND = 'guard-generate.flow-test';

export const FLOW_TEST_SESSION_BUDGET = { turns: 80, maxResumes: 1, tokenCeiling: 2_000_000 } as const;

/** One flow's whole wall clock: exploring a few screens, a seed, writing, a handful of runs. */
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
  /** The running product, and the id it was brought up under. */
  world: FlowTestWorld;
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
  const seedPath = flowSeedPath(input.repoRoot, input.flow.id);
  const seedRel = path.relative(input.repoRoot, seedPath);
  let lastRun: FlowTestResult | undefined;

  const runSpec = async (signal?: AbortSignal): Promise<{ ok: true; result: FlowTestResult } | { ok: false; reason: string }> => {
    lastRun = undefined;
    if (!fs.existsSync(specPath)) return { ok: false, reason: `There is no spec at ${specRel} yet.` };
    const spec = fs.readFileSync(specPath, 'utf-8');
    const defect =
      specDefect(spec) ??
      (fs.existsSync(seedPath)
        ? seedDefect(fs.readFileSync(seedPath, 'utf-8'), spec, flowSeedFileName(input.flow.id))
        : undefined);
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
      intro: `I'm writing the Playwright test for "${input.flow.title}" and the seed it starts from, against the running product.`,
    },
    systemPrompt: SYSTEM_PROMPT,
    computer: {
      cwd: input.repoRoot,
      tools: COMPUTER_TOOLS,
      env: flowTestEnv(input.repoRoot, input.world),
    },
    tools: [runTestTool(specRel, runSpec)],
    budget: FLOW_TEST_SESSION_BUDGET,
    // The gate of record: the engine's own run of the seed and the spec as
    // they stand, held against what the session says they prove.
    async validateOutcome(outcome) {
      if (outcome.status === 'blocked') {
        const left = [specPath, seedPath].filter((file) => fs.existsSync(file)).map((file) => path.relative(input.repoRoot, file));
        return left.length > 0
          ? `Outcome refused: a blocked flow has no test and no seed, but ${left.join(' and ')} exist${left.length === 1 ? 's' : ''}. Delete ${left.length === 1 ? 'it' : 'them'}, or finish the test and report what it proves.`
          : undefined;
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
  return { def, state: { lastRun: () => lastRun } };
}

/**
 * What a spec may not contain, as the reason it is refused. These are the
 * ways a test stops meaning what its result says: skipped, expected to fail,
 * or narrowed to part of itself.
 */
function specDefect(source: string): string | undefined {
  if (!/from ['"]\.\/flow['"]/.test(source)) {
    return "The spec does not import from './flow'. Its `test` comes from there (`test`, or `flowTest(seed)`), which is what records each step.";
  }
  if (!/\bexpect\s*[.(]/.test(source)) return 'The spec asserts nothing: it has no `expect`.';
  const banned = source.match(/\b(?:test|it|describe)\.(?:skip|fixme|fail|only)\b|\.describe\.(?:skip|fixme|only)\b/);
  if (banned) {
    return `The spec uses \`${banned[0]}\`. A test here runs whole and means what its result says: no skip, fixme, fail or only.`;
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

export function flowTestBriefing(input: FlowTestSessionInput): string {
  const { flow } = input;
  const { world } = input.world;
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
  const startsFrom = [...(flow.startingState?.seedable ?? []), ...(flow.startingState?.stepCreatable ?? [])];
  const supplied = flow.startingState?.supplied ?? [];
  return [
    `Write the test for ONE flow, and the seed it starts from: "${flow.title}" (${flow.id}).`,
    `Goal: ${flow.goal}`,
    ...(flow.notes ? [`Notes from whoever composed the flow: ${flow.notes}`] : []),
    '',
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
    'The path, in order. Each step is something the documents say the product does:',
    '',
    ...steps,
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

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more characters in the document)`;
}

const SYSTEM_PROMPT = `You write one Playwright test that proves one documented flow of a software product, against that product running in front of you, and the seed that creates what the flow starts from.

A flow is a short path through the product, made of claims its documentation makes. Your test walks that path the way the documents say a person does, and asserts what they promise at each step.

# Two sources, two jobs

- The DOCUMENTS say what to assert. The briefing quotes each claim and the section it comes from. Every assertion in your test is something those quotes say.
- The PRODUCT says how to get there: which page, which button, which request. Find that out by using it. You may read the repository's source to locate a route or a control, never to decide what the product should do.

When the product does something other than what the documents say, that is not a problem with your test. It is the finding. Keep the assertion the documents call for, let the test fail at that point, and report the flow as \`failing\` with the disagreement spelled out. Never weaken, drop or reword an assertion to make a test pass.

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
  await test.step('<step 1, in the document\\'s words>', async () => {
    // drive as seeded.owner, then assert what the document promises
  })
})
\`\`\`

- \`flowTest(seed)\` is Playwright's \`test\` bound to your seed: \`seeded\` is what the seed returned, typed as you returned it. A flow with no seed takes \`test\` itself from \`./flow\` (\`import { test, expect } from './flow'\`). Never import \`test\` from \`@playwright/test\`: the one from \`./flow\` is what records each step for whoever reads the result.
- \`./flow\` also has \`world\` (\`world.baseUrl\`, \`world.urls\`). Never hard-code a URL, port or credential.
- One \`test.step\` per step of the flow, in order, at the top level of the test, named by what the document claims. Each has at least one \`expect\` on something the user can observe. A reader sees these steps as a list, green or red, each with a picture of the page as the step ended: end a browser step with the page showing what the step proved.
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
5. When it fails, read the error and decide which it is. The seed not holding, or your test reaching for the wrong control or racing the page: fix them. The product not doing what the document says: that is the finding, keep the assertion.
6. Delete your scratch directory, then give the outcome.

# The outcome

- \`passing\`: the engine's run of your seed and spec passes. The product does what the documents say along this flow.
- \`failing\`: the spec asserts what the documents say and fails because the product does otherwise. Name the disagreement: \`documented\` (what the document says, and which one) and \`observed\` (what the product did). Be sure it is the product and not your test: reproduce it by hand first. A seed that fails is never this.
- \`blocked\`: no honest test can be written here, because the flow needs something this world does not have (a third-party account, a second machine, hardware) or its starting state cannot be created in this world by any means. Say what, in \`blockedBy\`, and name the missing thing in \`blockedOn\` as a short noun phrase in the product's own words (\`CurrencyBeacon API key\`, \`A product no other test is using\`): every flow blocked on the same thing is listed under that phrase, so use the plainest name for it. Leave no spec and no seed behind. A step that is merely hard to reach, or data that is merely tedious to create, is not blocked.

The engine runs your seed and spec once more when you give the outcome and holds you to it: \`passing\` must pass, \`failing\` must fail in the test.`;
