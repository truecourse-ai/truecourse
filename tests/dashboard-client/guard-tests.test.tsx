/**
 * THE TEST, as it is read: inside the flow that owns it, on the merged surface.
 *
 * There is no Tests tab and no standalone test destination — a flow and its test
 * are one entity. What this file covers is the SCENARIO RENDERING inside that
 * merged detail: it reads in the order a reader asks — what it checks → result →
 * setup → steps → evidence → the journey it drives, last. It creates no dismissal
 * of its own (that ruling is the flow's "don't test this flow", the only MANUAL
 * unit — see `guard-flows.test.tsx`), but it surfaces an EXISTING dismissal
 * already recorded against the failing milestone's claim, with its undo.
 *
 * The steps carry the failure: the diff (expected / actual / the program's output
 * excerpt) reads INSIDE the step that failed, under a section headed by the
 * milestone that step realizes — never as a top-level Expected/Actual pair, and
 * never as a second "Program output" section repeating the transcript below.
 *
 * EVERY step reads the same way — expected, actual, output — because the run's
 * evidence gives a passing step its actuals too. A step the run never reached says
 * so instead of showing a blank. Every row collapses and exactly one opens by
 * default: the failing one, per viewed result.
 *
 * The pane never scrolls SIDEWAYS: wide data scrolls inside its own block, which
 * is a structural rule (min-w-0 down the flex chain, x-clip on the pane and on the
 * list panels) that jsdom can only be shown as classes.
 */

import { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type {
  GuardDismissedClaim,
  GuardFlowDetail,
  GuardFlowListItem,
  GuardFlowsView,
  GuardJourneyRow,
  GuardRecipeCard,
  GuardScenarioResult,
  GuardScenarioSetupView,
} from '@truecourse/shared';
import { GuardDriftList } from '@/components/guard/GuardDriftList';
import { GuardFlowsPanel } from '@/components/guard/GuardFlowsPanel';
import { GuardFlowsPane } from '@/components/guard/GuardFlowsPane';
import { useGuardDecisions } from '@/hooks/useGuardDecisions';
import { useGuardFlowTabs } from '@/hooks/useGuardFlowTabs';
import { guardTestBinds } from '@/lib/guard-tests';
import { GUARD_CLAMP_LINES } from '@/components/guard/GuardLongText';
import type { GuardScenarioRowData } from '@/hooks/useGuardScenarios';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const DOC = 'docs/specs/tasks.md';
const FLOW_ID = 'task-lifecycle';
const PASSING_ID = 'task-lifecycle.cli.1';
const BIRTH_FAILED_ID = 'handle-pathological-files.cli.1';
const RUN_FAILED_ID = 'task-export.api.1';
const MANUAL_ID = 'tasks-help-smoke';
const RUN_ID = '2026-07-24T14-02-00Z_9f31c0aa';

/** The passing flow's chain — the claim sentences its step groups are headed with. */
const CLAIMS = ['A task is added and gets an id', 'A completed task reads as done'];

const FLOW_TITLES = new Map([
  [FLOW_ID, 'A user creates a task, sees it listed, completes it, and sees it done'],
  ['handle-pathological-files-without-freezing-analyze', 'Analyze survives a pathological file'],
  ['task-export', 'A user exports the task list'],
]);
const FLOW_GOALS = new Map([[FLOW_ID, 'Create, list, complete and filter a task from the CLI']]);

const result = (id: string, over: Partial<GuardScenarioResult> = {}): GuardScenarioResult => ({
  id,
  title: id,
  binds: { doc: DOC, section: 'tasks/creating-tasks', fingerprint: 'sha256:x' },
  outcome: 'pass',
  durationMs: 120,
  stage: 'run',
  ...over,
});

const INVENTORY: GuardScenarioRowData[] = [
  {
    id: PASSING_ID,
    title: 'Tasks are created, listed newest-first, completed and filterable',
    doc: DOC,
    anchor: 'tasks/creating-tasks',
    headingText: 'Creating tasks',
    file: 'scenarios/tasks/task-lifecycle.cli.1.yaml',
    handWritten: false,
    flowId: FLOW_ID,
    surface: 'cli',
    status: 'passing',
    lastResult: result(PASSING_ID, { outcome: 'pass', durationMs: 412 }),
  },
  {
    // Committed RED: it failed the first time it ran and no run has covered it
    // since, so the inventory paints the birth status.
    id: BIRTH_FAILED_ID,
    title: 'Analyze completes despite a pathological slow file',
    doc: 'README.md',
    anchor: 'analyze',
    headingText: 'Analyze',
    file: 'scenarios/analyze/pathological.cli.1.yaml',
    handWritten: false,
    flowId: 'handle-pathological-files-without-freezing-analyze',
    surface: 'cli',
    status: 'failing',
    lastResult: null,
  },
  {
    id: RUN_FAILED_ID,
    title: 'Exporting writes every task to the file',
    doc: DOC,
    anchor: 'tasks/exporting',
    file: 'scenarios/tasks/task-export.api.1.yaml',
    handWritten: false,
    flowId: 'task-export',
    surface: 'api',
    status: 'passing',
    lastResult: result(RUN_FAILED_ID, {
      outcome: 'fail',
      failure: { step: 2, expected: '200', actual: '500' },
    }),
  },
  {
    id: MANUAL_ID,
    title: '`tasks --help` prints usage',
    doc: DOC,
    anchor: 'tasks/cli',
    file: 'scenarios/manual/help.yaml',
    handWritten: true,
    flowId: `manual:${MANUAL_ID}`,
    surface: 'cli',
    lastResult: null,
  },
];

/** The spec bindings the merged detail's Spec footer row reads — the same index
 *  the page builds from the committed inventory. */
const BINDS = guardTestBinds(INVENTORY);

/** The scenario id each flow owns, for a test that names one and wants its flow. */
const FLOW_OF: Record<string, string> = {
  [PASSING_ID]: FLOW_ID,
  [BIRTH_FAILED_ID]: 'handle-pathological-files-without-freezing-analyze',
};

/** The merged list's rows — one per flow, the same corpus the inventory describes. */
const FLOW_ROWS: GuardFlowListItem[] = [...FLOW_TITLES].map(([flowId, title]) => ({
  flowId,
  title,
  goal: FLOW_GOALS.get(flowId) ?? '',
  status: flowId === FLOW_ID ? 'pass' : 'fail',
  bucket: 'guarded',
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 1,
  sectionCount: 1,
  docs: [DOC],
  surfaces: [],
  findings: 0,
  toolDefects: 0,
  errors: 0,
  journeyDrifted: false,
}));

const FLOW_DETAIL: GuardFlowDetail = {
  flowId: FLOW_ID,
  title: FLOW_TITLES.get(FLOW_ID)!,
  goal: FLOW_GOALS.get(FLOW_ID)!,
  status: 'pass',
  bucket: 'guarded',
  epic: false,
  manual: false,
  composedOf: [],
  milestones: CLAIMS.map((claimTitle, i) => ({
    order: i + 1,
    doc: DOC,
    anchor: 'tasks/creating-tasks',
    claimTitle,
    headingText: 'Creating tasks',
    live: true,
    drifted: false,
  })),
  surfaces: [
    {
      surface: 'cli',
      scenarioId: PASSING_ID,
      title: 'Tasks are created, listed newest-first, completed and filterable',
      status: 'pass',
      birthPassed: true,
      stage: 'run',
      outcome: 'pass',
      durationMs: 412,
      evidencePath: `.truecourse/guard/evidence/${RUN_ID}/${PASSING_ID}`,
      hasEvidence: true,
      journeyPath: ['cli/tasks-add'],
    },
  ],
  gaps: [],
  journeyIds: ['cli/tasks-add'],
  findings: [],
  errors: [],
  generatedAt: '2026-07-24T13:40:00.000Z',
  runId: RUN_ID,
  ranAt: '2026-07-24T14:02:00.000Z',
};

/** The claim behind the birth-failing test — the milestone its failing step realized. */
const BIRTH_CLAIM = {
  doc: 'README.md',
  anchor: 'analyze',
  title: 'Analyze finishes on every file it is given',
};

const BIRTH_FLOW_DETAIL: GuardFlowDetail = {
  ...FLOW_DETAIL,
  flowId: 'handle-pathological-files-without-freezing-analyze',
  title: FLOW_TITLES.get('handle-pathological-files-without-freezing-analyze')!,
  goal: 'Analyze a repo carrying a pathological file without freezing',
  status: 'fail',
  milestones: [
    {
      order: 1,
      doc: BIRTH_CLAIM.doc,
      anchor: BIRTH_CLAIM.anchor,
      claimTitle: BIRTH_CLAIM.title,
      headingText: 'Analyze',
      live: true,
      drifted: false,
    },
  ],
  surfaces: [
    {
      surface: 'cli',
      scenarioId: BIRTH_FAILED_ID,
      title: 'Analyze completes despite a pathological slow file',
      status: 'fail',
      birthPassed: false,
      stage: 'birth',
      failure: {
        step: 2,
        expected: 'exit 0',
        actual: 'timed out after 120s',
        stdout: 'analyzing 4211 files',
        stderr: 'warning: pathological file skipped',
      },
      failedMilestone: 1,
      // The verdict the generate reached about this birth failure — what it IS,
      // not just that it happened.
      triage: {
        verdict: 'code-drift',
        confidence: 'high',
        brief: 'The doc promises analyze finishes; the run timed out at 120s.',
        recommendation: 'Bound the per-file work, or document the timeout.',
      },
      evidencePath: '.truecourse/guard/evidence/birth/pathological',
      hasEvidence: true,
      journeyPath: [],
    },
  ],
  journeyIds: [],
};

const JOURNEYS: GuardJourneyRow[] = [
  {
    id: 'cli/tasks-add',
    type: 'cli',
    title: 'tasks add',
    entry: { command: ['tasks', 'add'] },
    steps: [{ kind: 'invoke', command: ['tasks', 'add'], flags: ['--json'] }],
    fingerprint: 'sha256:j1',
    flows: [{ flowId: FLOW_ID, title: FLOW_TITLES.get(FLOW_ID)!, realized: true }],
    scenarioIds: [PASSING_ID],
    source: 'tree',
  },
];

const YAML = ['guard: 3', `id: ${PASSING_ID}`, 'driver: cli'].join('\n');
/**
 * The parsed step list the server ships alongside the source. A preparation step
 * annotated with NO milestone leads it, then two steps realizing milestone 1 and
 * one realizing milestone 2 — the grouping the detail renders as sections.
 */
const STEPS = [
  { n: 1, kind: 'cli', command: 'tasks init', expectation: 'exit 0' },
  { n: 2, kind: 'cli', command: 'tasks add "write the spec"', expectation: 'exit 0', milestone: 1 },
  {
    n: 3,
    kind: 'cli',
    command: 'tasks list',
    env: ['NO_COLOR=1'],
    expectation: 'exit 0 · stdout contains “write the spec”',
    milestone: 1,
  },
  { n: 4, kind: 'cli', command: 'tasks done 1', expectation: 'exit 0', milestone: 2 },
];
/**
 * The same list as the SERVER merges it after the run that FAILED at step 2: steps 1
 * and 2 carry what they actually did, and the steps the run never reached carry
 * nothing — there is no record of them to show.
 */
const STEPS_STOPPED_AT_2 = STEPS.map((step) =>
  step.n === 1
    ? { ...step, actual: { n: 1, actual: 'exit 0', durationMs: 12, stdout: 'initialized tasks.json' } }
    : step.n === 2
      ? { ...step, actual: { n: 2, actual: 'timed out', durationMs: 120_004, stdout: 'analyzing 4211 files' } }
      : step,
);
/** The same list after the run that PASSED: every step executed, so every step has a record. */
const STEPS_ALL_RAN = STEPS.map((step) => ({
  ...step,
  actual: { n: step.n, actual: 'exit 0', durationMs: 20 + step.n, stdout: `step ${step.n} output` },
}));
/** The claim id a hand-authored test tags a step with, and the sentence behind it. */
const CLAIM_ID = 'a-task-is-added-and-gets-an-id';
/** The same file, tagged the way an AUTHORED corpus tags it: by claim IDENTITY. */
const CLAIM_TAGGED_STEPS = [
  { n: 1, command: 'tasks init', expectation: 'exit 0' },
  { n: 2, command: 'tasks add "write the spec"', expectation: 'exit 0', claims: [CLAIM_ID] },
];
const LONG_TRANSCRIPT_LINES = 60;
const RUN_TRANSCRIPT = [
  '$ tasks add "write the spec"',
  ...Array.from({ length: LONG_TRANSCRIPT_LINES - 2 }, (_, i) => `line ${i + 1}`),
  'ok',
].join('\n');
const BIRTH_TRANSCRIPT = '$ analyze .\ntimed out after 120s';

/** The decisions file the stub server holds — the dismiss/undismiss writes mutate
 *  it and answer with the updated file, exactly as the routes do. */
let dismissedClaims: GuardDismissedClaim[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
/** Which step list the stub server ships — positional milestones, or claim ids. */
let servedSteps: unknown[] = STEPS;
/** The starting world the stub server ships with the source; undefined = the file declares none. */
let servedSetup: GuardScenarioSetupView | undefined;
/** Every `/guard/scenario` URL the detail asked for — the run it named rides on it. */
let scenarioRequests: string[] = [];
/** Every `/guard/recipe/raw` URL asked for — the raw mode must be LAZY. */
let recipeRawRequests: string[] = [];
/** Every spec section the page jumped to, as `[doc, anchor]`. */
let openedSpec: [string, string][] = [];

/**
 * The recipe both readings are of. The card is the view model the pane is handed;
 * `RECIPE_RAW` is what the route answers — the stored file with its inline
 * credential ALREADY masked (the masking is the server's, and is pinned there).
 */
const RECIPE_FILE = '.truecourse/scenarios/recipe.json';
const RECIPE: GuardRecipeCard = {
  build: 'pnpm build',
  entry: ['node', 'dist/tasks.js'],
  serve: null,
  env: { TASKS_HOME: '.tmp/tasks' },
  fingerprint: 'sha256:9f2caabbccdd',
  stale: false,
};
const RECIPE_RAW = JSON.stringify(
  {
    build: 'pnpm build',
    entry: ['node', 'dist/tasks.js'],
    env: { TASKS_HOME: '.tmp/tasks' },
    api: { credentials: { 'api-key': { header: 'Authorization', value: '•••••••••••• (inline value, masked)' } } },
  },
  null,
  2,
);

const decisionsBody = () => json({ version: 1, dismissedClaims, dismissedFlows: [] });

beforeEach(() => {
  dismissedClaims = [];
  servedSteps = STEPS;
  servedSetup = undefined;
  scenarioRequests = [];
  recipeRawRequests = [];
  openedSpec = [];
  fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/guard/flows/')) {
      return json(u.includes('pathological') ? BIRTH_FLOW_DETAIL : FLOW_DETAIL);
    }
    if (u.includes('/guard/scenario?')) {
      scenarioRequests.push(u);
      return json({
        id: PASSING_ID,
        file: 'x.yaml',
        content: YAML,
        driver: 'cli',
        steps: servedSteps,
        ...(servedSetup ? { setup: servedSetup } : {}),
      });
    }
    if (u.includes('/guard/recipe/raw')) {
      recipeRawRequests.push(u);
      return json({ id: RECIPE_FILE, file: RECIPE_FILE, content: RECIPE_RAW });
    }
    if (u.includes('/guard/finding-evidence')) return new Response(BIRTH_TRANSCRIPT, { status: 200 });
    if (u.includes('/guard/evidence')) return new Response(RUN_TRANSCRIPT, { status: 200 });
    if (u.includes('/guard/decisions')) return decisionsBody();
    if (u.includes('/guard/undismiss')) {
      dismissedClaims = [];
      return decisionsBody();
    }
    if (u.includes('/guard/dismiss')) {
      dismissedClaims = [
        { ...(JSON.parse(String(init?.body)) as GuardDismissedClaim), dismissedAt: '2026-07-26T00:00:00.000Z' },
      ];
      return decisionsBody();
    }
    return json({});
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

// --- ONE row anatomy, in the one list that still shows results --------------

describe('the run-result row — the shared guard row anatomy', () => {
  it('leads with the TITLE and puts the status FIRST on the chip line', () => {
    render(
      <GuardDriftList
        drifts={[]}
        passed={[result(PASSING_ID, { title: 'Tasks are created', outcome: 'pass', durationMs: 412 })]}
        activeId={null}
        onPreview={() => {}}
        onPin={() => {}}
      />,
    );
    const row = within(screen.getByRole('list', { name: 'Run results' })).getAllByRole('listitem')[0];
    // Title first (it wraps — a claim is a sentence), then the chip line whose
    // FIRST chip is the one status word. That is the anatomy of every guard row.
    expect(row.firstElementChild).toHaveTextContent('Tasks are created');
    expect(row.children[1].firstElementChild).toHaveTextContent('Passing');
    // NO surface label: one surface per flow, so "CLI test" said nothing.
    expect(row).not.toHaveTextContent('CLI test');
  });

  it('drops the per-row extras in the Runs list — the detail carries them', () => {
    render(
      <GuardDriftList
        drifts={[result(RUN_FAILED_ID, {
          title: 'Exporting writes every task to the file',
          outcome: 'fail',
          durationMs: 900,
          failure: { step: 2, expected: '200', actual: '500' },
          flowId: 'task-export',
          failedMilestone: 2,
        })]}
        passed={[]}
        activeId={null}
        onPreview={() => {}}
        onPin={() => {}}
      />,
    );
    const row = within(screen.getByRole('list', { name: 'Run results' })).getAllByRole('listitem')[0];
    expect(row).toHaveTextContent('Failing');
    expect(row).toHaveTextContent('Exporting writes every task to the file');
    // No duration, no failure snippet, no id line.
    expect(row.textContent).not.toMatch(/900ms|failed at milestone|500/);
    expect(row.textContent).not.toContain(RUN_FAILED_ID);
  });

  it('wraps the title — a claim is a sentence, and a row never cuts it', () => {
    const title = 'Tasks are created, listed newest-first, completed and filterable';
    render(
      <GuardDriftList
        drifts={[]}
        passed={[result(PASSING_ID, { title })]}
        activeId={null}
        onPreview={() => {}}
        onPin={() => {}}
      />,
    );
    const el = screen.getByText(title);
    expect(el.className).toContain('break-words');
    expect(el.className).not.toContain('truncate');
    expect(el.className).not.toContain('line-clamp');
  });
});

// --- The merged surface: a test is read inside its flow ---------------------

function TestsHarness({
  claimTitles,
  recipe = RECIPE,
}: {
  claimTitles?: Readonly<Record<string, string>>;
  /** The recipe the LIST's affordance opens; null hides it entirely. */
  recipe?: GuardRecipeCard | null;
}) {
  const tabs = useGuardFlowTabs('r');
  // The real decisions hook — the ruling's write path is under test, not a stub.
  const decisions = useGuardDecisions('r', true);
  const loc = useLocation();
  const [filter, setFilter] = useState<'all'>('all');
  const [recipeOpen, setRecipeOpen] = useState(false);
  const view = { flows: FLOW_ROWS, recipe } as unknown as GuardFlowsView;
  return (
    <div>
      <span data-testid="search">{loc.search}</span>
      <div data-testid="panel">
        <GuardFlowsPanel
          flows={FLOW_ROWS}
          loading={false}
          error={null}
          activeId={recipeOpen ? null : tabs.activeId}
          filter={filter}
          onFilter={() => {}}
          onOpen={(id, pinned) => {
            setRecipeOpen(false);
            tabs.open(id, pinned);
          }}
          hasRecipe={recipe != null}
          recipeOpen={recipeOpen}
          onToggleRecipe={() => setRecipeOpen((open) => !open)}
        />
      </div>
      <GuardFlowsPane
        repoId="r"
        view={view}
        loading={false}
        error={null}
        recipe={recipe}
        recipeOpen={recipeOpen}
        onCloseRecipe={() => setRecipeOpen(false)}
        journeys={JOURNEYS}
        {...(claimTitles ? { claimTitles } : {})}
        binds={BINDS}
        decisions={decisions}
        tabs={tabs}
        onOpenJourney={() => {}}
        onOpenSpec={(doc, section) => openedSpec.push([doc, section])}
      />
    </div>
  );
}

const renderPane = (
  url = '/repos/r?tab=guardflows',
  props: { claimTitles?: Readonly<Record<string, string>>; recipe?: GuardRecipeCard | null } = {},
) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <TestsHarness {...props} />
    </MemoryRouter>,
  );

/** Open the flow that owns a test — the one destination a test is read at. */
const renderTest = (
  scenarioId: string,
  props: { claimTitles?: Readonly<Record<string, string>> } = {},
) => renderPane(`/repos/r?tab=guardflows&gflow=${FLOW_OF[scenarioId]}`, props);

const search = () => screen.getByTestId('search').textContent ?? '';

/**
 * The detail's settle point — BOTH of its fetches, rendered.
 *
 * `test steps` is a STABLE container: it renders from the first paint, holding
 * "Loading steps…", because a failure must read even for a file that never parses
 * into steps. Finding it therefore settles nothing. TWO fetches fill the page —
 * the scenario source brings the step ROWS, and the flow join brings the result
 * they are painted from (pass/fail/not-reached), the failure card, the evidence
 * pointer and the milestone chain their sections are headed by. Waiting on the
 * container alone reads a half-loaded page, which is only ever a question of
 * which tick the mocked fetch lands on.
 */
async function findSteps(): Promise<HTMLElement> {
  const steps = await screen.findByLabelText('test steps');
  // The scenario source landed: the file's steps, not the loading line.
  await within(steps).findAllByRole('listitem');
  // The flow join landed: a milestone section is headed by its CLAIM, and only
  // the flow detail carries claims. It arrives with the result in one state
  // update, so this one signal proves both.
  await waitFor(() =>
    expect(within(steps).getByText('Milestone 1').parentElement).toHaveTextContent(/Milestone 1 — \S/),
  );
  return steps;
}

describe('the test, read inside its flow', () => {
  it('opening a flow from the list mirrors ?gflow and renders its test in full', async () => {
    const user = userEvent.setup();
    renderPane();
    await user.click(within(screen.getByTestId('panel')).getByText(FLOW_TITLES.get(FLOW_ID)!));
    expect(search()).toContain(`gflow=${FLOW_ID}`);
    expect(await findSteps()).toBeInTheDocument();
  });

  it('reads what it checks → verdict → steps → evidence → journey, in that order', async () => {
    renderTest(PASSING_ID);
    const steps = await findSteps();

    const order = ['What it checks', 'Verdict', 'Steps', 'Evidence', 'Journey'];
    const positions = order.map((label) => {
      const el = screen.getByText(label);
      return { label, top: Array.from(document.querySelectorAll('*')).indexOf(el) };
    });
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i].top, `${positions[i].label} after ${positions[i - 1].label}`).toBeGreaterThan(
        positions[i - 1].top,
      );
    }

    // What it checks: the TEST's own sentence, one line. The flow's goal is one
    // level up, in the header above it — never repeated here as the same fact.
    expect(
      screen.getByText('Tasks are created, listed newest-first, completed and filterable', {
        selector: 'p',
      }),
    ).toBeInTheDocument();
    // The goal renders in the flow header and NOWHERE below it: the panel row and
    // that header are the two places it belongs, and the body never restates it.
    const goals = screen.getAllByText(FLOW_GOALS.get(FLOW_ID)!);
    expect(goals).toHaveLength(2);
    expect(goals.every((el) => el.closest('[aria-label="test steps"]') === null)).toBe(true);
    // The verdict, then the steps as STEPS (not a YAML blob) and the transcript.
    expect(screen.getByText('passed')).toBeInTheDocument();
    expect(within(steps).getAllByRole('listitem')).toHaveLength(STEPS.length);
    // The command reads in the STEP — asked of the page at large it is ambiguous,
    // since the transcript below opens on the same line.
    expect(within(steps).getByText('tasks add "write the spec"')).toBeInTheDocument();
    // …and the transcript arrives on its own fetch, chained behind the join.
    await waitFor(() =>
      expect(screen.getByLabelText('evidence transcript')).toHaveTextContent('$ tasks add "write the spec"'),
    );
    // The journey renders LAST, as a sequence diagram.
    const diagram = await screen.findByRole('group', { name: 'Journey cli/tasks-add' });
    expect(within(diagram).getByText('User')).toBeInTheDocument();
  });

  // The status says the test is red; the chip says whose fault that
  // is, and the recommendation is the one line a reader acts on.
  it('carries the triage verdict beside the failure, with its unblock', async () => {
    renderTest(BIRTH_FAILED_ID);
    await findSteps();

    expect(screen.getByText('code drift')).toBeInTheDocument();
    expect(screen.getByText(/Bound the per-file work/)).toBeInTheDocument();
    // The verdict is a chip beside the status, never a replacement for it.
    expect(screen.getByText('failed (birth)')).toBeInTheDocument();
  });

  it('a passing test carries no verdict chip — there is nothing to blame', async () => {
    renderTest(PASSING_ID);
    await findSteps();
    expect(screen.queryByText('code drift')).not.toBeInTheDocument();
    expect(screen.queryByText('our defect')).not.toBeInTheDocument();
  });

  it('slims the verdict to WHERE IT BROKE, never the diff', async () => {
    renderTest(BIRTH_FAILED_ID);
    await findSteps();
    // The stage the failure came from and the step + milestone it broke at. The
    // diff itself reads at the step; the verdict never guesses a claim title.
    expect(screen.getByText('failed (birth)')).toBeInTheDocument();
    const card = screen.getByText(/Failed at step/).closest('div.rounded.border') as HTMLElement;
    expect(within(card).getByText(/milestone 1/)).toBeInTheDocument();
    expect(within(card).queryByText(BIRTH_CLAIM.title)).toBeNull();
    expect(within(card).queryByText('Expected')).toBeNull();
    expect(within(card).queryByText('Actual')).toBeNull();
    expect(within(card).queryByLabelText('expected value')).toBeNull();
    expect(within(card).queryByLabelText('actual value')).toBeNull();
    // Red is a BORDER, never a fill.
    expect(card.className).toMatch(/border-red-500/);
    expect(card.className).not.toMatch(/bg-red-/);
  });

  it('paints each step from the viewed result — pass, fail, not reached', async () => {
    const user = userEvent.setup();
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    // The birth failure broke at step 2 of the four-step file.
    expect(within(steps).getByLabelText(/Step 1: .* — passed/)).toBeInTheDocument();
    expect(within(steps).getByLabelText(/Step 2: .* — failed/)).toBeInTheDocument();
    expect(within(steps).getByLabelText(/Step 3: .* — not reached/)).toBeInTheDocument();
    expect(within(steps).getByLabelText(/Step 4: .* — not reached/)).toBeInTheDocument();
    // A step reads as a step: its command on the row, and — once opened — the world
    // it runs in beside what it asserts.
    expect(within(steps).getByText('tasks list')).toBeInTheDocument();
    await user.click(within(steps).getByRole('button', { name: 'Expand step 3' }));
    const third = within(steps)
      .getAllByRole('listitem')
      .find((r) => (r.getAttribute('aria-label') ?? '').startsWith('Step 3:'))!;
    expect(within(third).getByText(/NO_COLOR=1/)).toBeInTheDocument();
    expect(within(third).getByLabelText('expected value')).toHaveTextContent('exit 0 · stdout contains');
  });

  it('makes EVERY step collapsible, and opens the failing one', async () => {
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    // Every row is a toggle — every row has the same three fields to show…
    const rows = within(steps).getAllByRole('listitem');
    for (const row of rows) expect(within(row).queryAllByRole('button')).toHaveLength(1);
    // …and exactly ONE of them is open: the one the reader came for.
    const toggles = within(steps).getAllByRole('button', { expanded: true });
    expect(toggles).toHaveLength(1);
    expect(toggles[0]).toHaveAccessibleName('Collapse step 2');
    expect(within(steps).getAllByLabelText('expected value')).toHaveLength(1);
  });

  it('gives EVERY step the same panel — expected, actual, output', async () => {
    const user = userEvent.setup();
    servedSteps = STEPS_STOPPED_AT_2;
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    const rowOf = (n: number) =>
      within(steps)
        .getAllByRole('listitem')
        .find((r) => (r.getAttribute('aria-label') ?? '').startsWith(`Step ${n}:`))!;

    // The step that PASSED carries its run record: what it asserted, the exit code
    // it returned, and what it printed — the same three labels as the failure.
    await user.click(within(rowOf(1)).getByRole('button', { name: 'Expand step 1' }));
    const passing = rowOf(1);
    expect(within(passing).getByLabelText('expected value')).toHaveTextContent('exit 0');
    expect(within(passing).getByLabelText('actual value')).toHaveTextContent('exit 0');
    expect(within(passing).getByLabelText('step output')).toHaveTextContent('initialized tasks.json');
    for (const label of ['expected', 'actual', 'output']) {
      expect(within(passing).getByText(label)).toBeInTheDocument();
    }
  });

  it('says so when a step has no record, instead of showing a blank', async () => {
    const user = userEvent.setup();
    servedSteps = STEPS_STOPPED_AT_2;
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    // Step 3 was never reached — the run stopped at 2. Its expectation is still true
    // of the file, and the other two fields say there is nothing behind them.
    await user.click(within(steps).getByRole('button', { name: 'Expand step 3' }));
    const notReached = within(steps)
      .getAllByRole('listitem')
      .find((r) => (r.getAttribute('aria-label') ?? '').startsWith('Step 3:'))!;
    expect(within(notReached).getByLabelText('expected value')).toBeInTheDocument();
    expect(within(notReached).queryByLabelText('actual value')).toBeNull();
    expect(within(notReached).queryByLabelText('step output')).toBeNull();
    expect(within(notReached).getAllByText('not recorded in this run')).toHaveLength(2);
  });

  it('asks for the steps of the RUN it is showing, so the actuals are that run’s', async () => {
    renderTest(PASSING_ID);
    await findSteps();
    expect(scenarioRequests.some((u) => u.includes(`runId=${encodeURIComponent(RUN_ID)}`))).toBe(true);
  });

  it('asks by evidence PATH for a birth result — there is no run behind one', async () => {
    renderTest(BIRTH_FAILED_ID);
    await findSteps();
    expect(scenarioRequests.some((u) => u.includes('evidencePath='))).toBe(true);
    expect(scenarioRequests.every((u) => !u.includes('runId='))).toBe(true);
  });

  it('closes the failing step on click, and opens it again', async () => {
    const user = userEvent.setup();
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    const toggle = within(steps).getByRole('button', { name: 'Collapse step 2' });

    // Open by default is a default, not a lock: the diff puts away.
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('expected value')).toBeNull();
    expect(screen.queryByLabelText('actual value')).toBeNull();
    // The step itself never leaves — only its detail did.
    expect(within(steps).getByLabelText(/Step 2: .* — failed/)).toBeInTheDocument();
    expect(toggle).toHaveAccessibleName('Expand step 2');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('expected value')).toBeInTheDocument();
  });

  it('tells a step’s expectation ONCE — the labelled field, not a summary', async () => {
    const user = userEvent.setup();
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    const failing = within(steps)
      .getAllByRole('listitem')
      .find((r) => (r.getAttribute('aria-label') ?? '').includes('— failed'))!;
    // The labelled field says what it wanted…
    expect(within(failing).getByText('expected')).toBeInTheDocument();
    expect(within(failing).getByLabelText('expected value')).toHaveTextContent('exit 0');
    // …so the "expects …" summary line that would repeat it exists on no row at all,
    // open or closed. One rendering of one fact.
    await user.click(within(steps).getByRole('button', { name: 'Expand step 1' }));
    expect(within(steps).queryByText(/^expects/)).toBeNull();
  });

  it('reads the diff INSIDE the step that failed — and nowhere else', async () => {
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    const rows = within(steps).getAllByRole('listitem');
    const failing = rows.find((r) => (r.getAttribute('aria-label') ?? '').includes('— failed'))!;

    // What it wanted, what it got, and what the program printed — all at the step.
    expect(within(failing).getByText('expected')).toBeInTheDocument();
    expect(within(failing).getByLabelText('expected value')).toHaveTextContent('exit 0');
    expect(within(failing).getByLabelText('actual value')).toHaveTextContent('timed out after 120s');
    expect(within(failing).getByLabelText('step output')).toHaveTextContent('analyzing 4211 files');
    expect(within(failing).getByLabelText('step error output')).toHaveTextContent(
      'warning: pathological file skipped',
    );

    // The other rows are closed, so the diff reads at the failure and nowhere else…
    for (const row of rows.filter((r) => r !== failing)) {
      expect(within(row).queryByText('expected')).toBeNull();
      expect(within(row).queryByLabelText('expected value')).toBeNull();
      expect(within(row).queryByLabelText('actual value')).toBeNull();
    }
    // …and the page tells it exactly once.
    expect(screen.getAllByLabelText('expected value')).toHaveLength(1);
    expect(screen.getAllByLabelText('actual value')).toHaveLength(1);
    // Same wide-content rule as the transcript: no wrapping, sideways scroll.
    for (const label of ['expected value', 'actual value', 'step output', 'step error output']) {
      const block = within(failing).getByLabelText(label);
      expect(block.className).toContain('whitespace-pre');
      expect(block.className).not.toContain('whitespace-pre-wrap');
      expect(block.className).toContain('overflow-x-auto');
    }
  });

  it('a PASSING test opens nothing by default — and every row still opens', async () => {
    const user = userEvent.setup();
    servedSteps = STEPS_ALL_RAN;
    renderTest(PASSING_ID);
    const steps = await findSteps();
    expect(within(steps).getAllByLabelText(/— passed/)).toHaveLength(STEPS.length);
    // Nothing failed, so no row claims the page: they all start closed.
    expect(screen.queryByLabelText('expected value')).toBeNull();
    expect(screen.queryByLabelText('actual value')).toBeNull();
    expect(within(steps).queryAllByRole('button', { expanded: true })).toHaveLength(0);
    // Every STEP is a button (the group headers carry a section link of their own,
    // which is not one of these).
    expect(within(steps).getAllByRole('button', { name: /^Expand step/ })).toHaveLength(STEPS.length);
    // …and a green step's record is one click away, exactly like a red one's.
    await user.click(within(steps).getByRole('button', { name: 'Expand step 2' }));
    expect(within(steps).getByLabelText('actual value')).toHaveTextContent('exit 0');
    expect(within(steps).getByLabelText('step output')).toHaveTextContent('step 2 output');
    // The sections the list is read BY are always visible.
    for (const header of ['Prepare', 'Milestone 1', 'Milestone 2']) {
      expect(within(steps).getByText(header)).toBeInTheDocument();
    }
  });

  it('carries NO Program output section — the excerpt is the step’s, the streams are evidence', async () => {
    renderTest(BIRTH_FAILED_ID);
    await findSteps();
    // The section, and its stream sub-headings, are gone: the failing step's
    // excerpt and the one transcript below say all of it.
    expect(screen.queryByText('Program output')).toBeNull();
    expect(screen.queryByText(/^stdout$/i)).toBeNull();
    expect(screen.queryByText(/^stderr$/i)).toBeNull();
  });

  it('groups the steps by MILESTONE, headed by the claim — no per-row tags', async () => {
    renderTest(PASSING_ID);
    const steps = await findSteps();
    // The un-annotated preparation step heads its own section…
    expect(within(steps).getByText('Prepare')).toBeInTheDocument();
    // …then each milestone, named by the claim its steps realize.
    expect(within(steps).getByText('Milestone 1')).toBeInTheDocument();
    expect(within(steps).getByText(new RegExp(CLAIMS[0]))).toBeInTheDocument();
    expect(within(steps).getByText('Milestone 2')).toBeInTheDocument();
    expect(within(steps).getByText(new RegExp(CLAIMS[1]))).toBeInTheDocument();
    // The tag that used to ride each row is gone — the header carries it now.
    expect(within(steps).queryByText(/^milestone \d+$/)).toBeNull();
    // Sections, not a re-ordering: every step still renders, in file order.
    expect(within(steps).getAllByRole('listitem')).toHaveLength(STEPS.length);
  });

  /**
   * The chain lives HERE now: the flow detail dropped its milestone list, so the
   * group header is the only thing left carrying the jump to the section its
   * steps prove. Losing it would have made the merge a deletion.
   */
  it('links each milestone group to the spec section that states it', async () => {
    const user = userEvent.setup();
    renderTest(PASSING_ID);
    const steps = await findSteps();

    const links = within(steps).getAllByRole('button', { name: /^§/ });
    expect(links).toHaveLength(2); // one per milestone group — never on Prepare
    expect(links[0]).toHaveTextContent('§ Creating tasks');
    // The header's own words are untouched: the claim SENTENCE still reads in full.
    expect(within(steps).getByText(new RegExp(CLAIMS[0]))).toBeInTheDocument();

    await user.click(links[0]);
    expect(openedSpec).toEqual([[DOC, 'tasks/creating-tasks']]);
  });

  /**
   * WHAT a step drives, on every row. It is a fact about the step, never a verdict
   * about it, so it is a plain word and carries no colour: the glyph is the only
   * thing on the row that says how the step fared.
   */
  it('labels every step with what it drives, in plain uncoloured words', async () => {
    servedSteps = [
      { n: 1, kind: 'cli', command: 'tasks init', expectation: 'exit 0' },
      { n: 2, kind: 'git', command: 'git init', expectation: 'exit 0' },
      { n: 3, kind: 'file', command: 'write notes.md', expectation: 'notes.md exists' },
    ];
    renderTest(PASSING_ID);
    const steps = await screen.findByLabelText('test steps');
    const rows = await within(steps).findAllByRole('listitem');

    for (const [i, kind] of ['cli', 'git', 'file'].entries()) {
      const label = within(rows[i]).getByText(kind);
      expect(label.className).not.toMatch(/(red|emerald|sky|amber)-\d{2,3}/);
    }
  });

  it('heads a milestone the flow does not name by its number alone', async () => {
    // The birth flow declares milestone 1 only; the file's step 4 realizes 2.
    renderTest(BIRTH_FAILED_ID);
    const steps = await findSteps();
    expect(within(steps).getByText(new RegExp(BIRTH_CLAIM.title))).toBeInTheDocument();
    expect(within(steps).getByText('Milestone 2')).toBeInTheDocument();
  });

  it('switches between the page and the raw file, and defaults to the page', async () => {
    const user = userEvent.setup();
    renderTest(PASSING_ID);
    await findSteps();
    const modes = screen.getByRole('group', { name: 'View mode' });
    // EXACTLY two readings — the page and the artifact. There is no third.
    expect(within(modes).getAllByRole('button').map((b) => b.textContent)).toEqual(['View', 'YAML']);
    expect(within(modes).getByRole('button', { name: 'View' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('test source')).not.toBeInTheDocument();

    await user.click(within(modes).getByRole('button', { name: 'YAML' }));
    // The whole file, in the pane's own scroll context — no clamp, no expander.
    // The block is stable like the step container is: it renders the moment the
    // mode flips, holding "Loading…" until the source lands — so the wait is for
    // the CONTENT, never for the element.
    await waitFor(() => expect(screen.getByLabelText('test source')).toHaveTextContent('guard: 3'));
    expect(screen.queryByLabelText('test steps')).not.toBeInTheDocument();
    expect(screen.queryByText(/Show all \d+ lines/)).not.toBeInTheDocument();

    await user.click(within(modes).getByRole('button', { name: 'View' }));
    expect(await findSteps()).toBeInTheDocument();
  });

  it('closes with LABELLED footer rows — no fingerprints, no source affordance', async () => {
    renderTest(PASSING_ID);
    await findSteps();
    // Test · File · Spec. NOT "Flow": the page IS the flow, and a footer jump to
    // the thing you are reading is a destination that goes nowhere.
    for (const label of ['Test', 'File', 'Spec']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('Flow')).toBeNull();
    expect(screen.getByText('x.yaml')).toBeInTheDocument();
    // The Spec row comes off the committed inventory's binding.
    expect(screen.getByText('Creating tasks')).toBeInTheDocument();
    expect(screen.queryByText('View source')).not.toBeInTheDocument();
    expect(screen.queryByText(/sha256/)).not.toBeInTheDocument();
  });

  it('clamps a long transcript and grows it INLINE — never a vertical scroll box', async () => {
    const user = userEvent.setup();
    renderTest(PASSING_ID);
    const expander = await screen.findByText(`Show all ${LONG_TRANSCRIPT_LINES} lines`);
    const block = screen.getByLabelText('evidence transcript');
    expect(block.textContent?.split('\n')).toHaveLength(GUARD_CLAMP_LINES);
    // A transcript line is never re-wrapped — it keeps its shape and the block
    // scrolls SIDEWAYS for the width the pane cannot give it.
    expect(block.className).toContain('whitespace-pre');
    expect(block.className).not.toContain('whitespace-pre-wrap');
    expect(block.className).toContain('overflow-x-auto');
    // Height is still the page's job.
    expect(block.className).not.toMatch(/overflow-y|max-h-/);
    // Nothing in its ancestry scrolls: the pane is the only scroll context.
    for (let el = block.parentElement; el && el.tagName !== 'BODY'; el = el.parentElement) {
      if (el.className.includes('flex-1')) break;
      expect(el.className).not.toMatch(/overflow-(auto|scroll|y-auto|y-scroll)|max-h-/);
    }
    await user.click(expander);
    expect(screen.getByLabelText('evidence transcript').textContent?.split('\n')).toHaveLength(
      LONG_TRANSCRIPT_LINES,
    );
    expect(screen.getByText('Collapse')).toBeInTheDocument();
  });

  // jsdom lays nothing out, so the rule is pinned as STRUCTURE: a wide line can
  // only scroll the block it is in if every box above that block is allowed to
  // shrink (min-w-0) and none of them scrolls sideways itself.
  it('confines sideways scroll to the data blocks — the pane never scrolls sideways', async () => {
    renderTest(BIRTH_FAILED_ID);
    await findSteps();
    for (const label of ['expected value', 'actual value', 'step output', 'evidence transcript']) {
      const block = await screen.findByLabelText(label);
      // The block scrolls itself, and can never out-grow the column it sits in.
      expect(block.className, label).toContain('overflow-x-auto');
      expect(block.className, label).toContain('max-w-full');
      for (let el = block.parentElement; el && el.tagName !== 'BODY'; el = el.parentElement) {
        const cls = el.className;
        expect(cls, `${label} — an ancestor scrolls sideways: ${cls}`).not.toContain('overflow-x-auto');
        if (/(^|\s)(flex|inline-flex|grid)(\s|$)/.test(cls)) {
          expect(cls, `${label} — a flex ancestor cannot shrink: ${cls}`).toContain('min-w-0');
        }
      }
    }
    // The pane's own scroll: down, explicitly — `overflow-y-auto` on its own would
    // compute the x axis to `auto` and hand a wide line the whole page.
    const pane = screen.getByLabelText('evidence transcript').closest('.flex-1') as HTMLElement;
    expect(pane.className).toContain('overflow-y-auto');
    expect(pane.className).toContain('overflow-x-hidden');
  });

  it('marks a test that failed at BIRTH and reads its birth transcript', async () => {
    renderTest(BIRTH_FAILED_ID);
    // The status word reads off the INVENTORY, before either fetch lands — the
    // failure it belongs to is the flow join's, so the page must settle first.
    await findSteps();
    expect(screen.getByText('failed (birth)')).toBeInTheDocument();
    expect(screen.getByText('timed out after 120s')).toBeInTheDocument();
    // A birth failure's transcript is addressed by its stored path, not by a run.
    expect(await screen.findByText(/analyze \./)).toBeInTheDocument();
  });

  it('offers NO way out to a second home for the test on the page', async () => {
    renderTest(PASSING_ID);
    await findSteps();
    // The flow row is gone from the footer: the page IS the flow. What is left is
    // the id, the file, and the spec section — facts, not destinations.
    expect(screen.queryByRole('button', { name: new RegExp(FLOW_TITLES.get(FLOW_ID)!.slice(0, 20)) })).toBeNull();
    // …and no test address at all: a flow is the only thing the URL can name.
    expect(search()).not.toContain('gtest=');
  });

  it('rests on "pick a flow" when nothing is open — the LIST is the tab', () => {
    renderPane();
    // ONE short line, and no explainer under it: a rest state says what to do.
    expect(screen.getByText('Select a test')).toBeInTheDocument();
    expect(screen.queryByText(/Guard commits every test it writes/)).toBeNull();
    // No second control over the list's narrowing, and no Overview destination.
    expect(screen.queryByRole('group', { name: 'Flow filters' })).not.toBeInTheDocument();
    expect(screen.queryByText('Overview')).not.toBeInTheDocument();
  });
});

// --- The RECIPE: the preparation behind every test in the list -------------
//
// It is not a flow, so it is not a row; it is the ONE affordance the LIST carries
// beside its rows, opening the same two readings every artifact-backed entity
// offers. WHERE it sits is `guard-flows.test.tsx`; WHAT it opens is here.

describe('the recipe — the two readings of the preparation', () => {
  const recipeButton = () => within(screen.getByTestId('panel')).getByRole('button', { name: 'Recipe' });
  const openRecipe = async (user: ReturnType<typeof userEvent.setup>) => user.click(recipeButton());

  it('opens the structured recipe — and closes again on a second click', async () => {
    const user = userEvent.setup();
    renderPane();
    expect(screen.queryByRole('region', { name: 'Recipe' })).not.toBeInTheDocument();

    await openRecipe(user);
    const recipe = screen.getByRole('region', { name: 'Recipe' });
    expect(within(recipe).getByText('pnpm build')).toBeInTheDocument();
    expect(within(recipe).getByText('node dist/tasks.js')).toBeInTheDocument();
    expect(within(recipe).getByText('TASKS_HOME=.tmp/tasks')).toBeInTheDocument();
    expect(recipeButton()).toHaveAttribute('aria-pressed', 'true');

    await openRecipe(user);
    expect(screen.queryByRole('region', { name: 'Recipe' })).not.toBeInTheDocument();
    expect(screen.getByText('Select a test')).toBeInTheDocument();
  });

  it('offers the two readings, and reads the FILE only when asked (lazily)', async () => {
    const user = userEvent.setup();
    renderPane();
    await openRecipe(user);
    // Nothing was fetched for a reader who never left the structured view.
    expect(recipeRawRequests).toHaveLength(0);

    const modes = within(screen.getByRole('region', { name: 'Recipe' })).getByRole('group', {
      name: 'View mode',
    });
    expect(within(modes).getAllByRole('button').map((b) => b.textContent)).toEqual(['View', 'JSON']);
    await user.click(within(modes).getByRole('button', { name: 'JSON' }));

    const raw = await screen.findByLabelText('recipe source');
    await waitFor(() => expect(raw.textContent).toContain('"build": "pnpm build"'));
    expect(recipeRawRequests).toHaveLength(1);
    // A SINGLETON artifact: one recipe per repo, addressed by no id.
    expect(recipeRawRequests[0]).not.toContain('id=');
  });

  it('shows the file as the server masked it — the raw mode is no secret door', async () => {
    const user = userEvent.setup();
    renderPane();
    await openRecipe(user);
    await user.click(
      within(within(screen.getByRole('region', { name: 'Recipe' })).getByRole('group', { name: 'View mode' }))
        .getByRole('button', { name: 'JSON' }),
    );
    const raw = await screen.findByLabelText('recipe source');
    await waitFor(() => expect(raw.textContent).toContain('inline value, masked'));
    // The capability stays readable; the value never arrives to be shown.
    expect(raw.textContent).toContain('"header": "Authorization"');
    expect(raw.textContent).not.toMatch(/sk-|secret/);
  });

  it('picking a flow navigates AWAY from the recipe — one body, one subject', async () => {
    const user = userEvent.setup();
    renderPane();
    await openRecipe(user);
    expect(screen.getByRole('region', { name: 'Recipe' })).toBeInTheDocument();

    await user.click(within(screen.getByTestId('panel')).getByText(FLOW_TITLES.get(FLOW_ID)!));
    expect(await findSteps()).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Recipe' })).not.toBeInTheDocument();
    expect(recipeButton()).toHaveAttribute('aria-pressed', 'false');
  });

  it('offers nothing at all when the repo has no recipe yet', () => {
    render(
      <MemoryRouter initialEntries={['/repos/r?tab=guardflows']}>
        <TestsHarness recipe={null} />
      </MemoryRouter>,
    );
    expect(within(screen.getByTestId('panel')).queryByRole('button', { name: 'Recipe' })).toBeNull();
  });
});

// --- Reading an existing claim dismissal (a test creates none of its own) --

describe('an existing claim dismissal, read-only from the test that failed', () => {
  const postsTo = (path: string) =>
    fetchMock.mock.calls.filter((c) => String(c[0]).includes(path)).map((c) => c[1] as RequestInit);

  it('a FAILING test with no recorded dismissal shows no dismissal note', async () => {
    renderTest(BIRTH_FAILED_ID);
    await findSteps();
    expect(screen.queryByText(/This claim is dismissed/)).toBeNull();
    expect(screen.queryByText(/Guard dismissed this claim automatically/)).toBeNull();
  });

  it('a PASSING test shows no dismissal note, even with one on record', async () => {
    dismissedClaims = [{ ...BIRTH_CLAIM, dismissedAt: '2026-07-25T10:00:00.000Z' }];
    renderTest(PASSING_ID);
    await findSteps();
    expect(screen.getByText('passed')).toBeInTheDocument();
    expect(screen.queryByText(/This claim is dismissed/)).toBeNull();
  });

  it('an already-dismissed claim reads as dismissed, and undo puts it back', async () => {
    const user = userEvent.setup();
    dismissedClaims = [{ ...BIRTH_CLAIM, dismissedAt: '2026-07-25T10:00:00.000Z' }];
    renderTest(BIRTH_FAILED_ID);

    expect(await screen.findByText(/This claim is dismissed/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'undo' }));

    const writes = postsTo('/guard/undismiss');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0].body))).toEqual(BIRTH_CLAIM);
    // The note goes with it — a test offers no button to bring the dismissal back.
    await waitFor(() => expect(screen.queryByText(/This claim is dismissed/)).toBeNull());
  });

  // The AUTO tier: a dismissal the tool recorded itself. No engine path writes
  // one today, so this is the defensive read — a record that arrives marked
  // `auto` must never be passed off as the reader's own judgment.
  it('an AUTO dismissal names the machine, quotes its reason, and keeps the undo', async () => {
    const user = userEvent.setup();
    dismissedClaims = [
      {
        ...BIRTH_CLAIM,
        dismissedAt: '2026-07-25T10:00:00.000Z',
        auto: true,
        reason: 'The test asserted a flag the spec never promises — a generation defect.',
      },
    ];
    renderTest(BIRTH_FAILED_ID);

    expect(await screen.findByText(/Guard dismissed this claim automatically/)).toBeInTheDocument();
    // Never re-worded as the user's own ruling.
    expect(screen.queryByText(/^This claim is dismissed/)).toBeNull();
    // The machine's stated reason rides with it, verbatim.
    expect(screen.getByText(/a generation defect/)).toBeInTheDocument();
    // A machine's call is exactly the kind a human revisits, so undo stays.
    await user.click(screen.getByRole('button', { name: 'undo' }));
    expect(postsTo('/guard/undismiss')).toHaveLength(1);
  });
});

describe('the step list reads a claim-identity milestone as its claim', () => {
  // An authored test tags its steps with claim IDs, not flow positions. The claim
  // corpus is what turns an id into the sentence the group header reads, and it
  // reaches the detail through the pane — a drop anywhere on that chain sends
  // every such group back to reading "Prepare".
  /**
   * The settle point for a claim-tagged file. `findSteps` waits on "Milestone 1",
   * which a claim-identity group deliberately never renders — so these wait on the
   * header they DO expect, which lands with the same scenario-source fetch.
   */
  const findClaimHeader = async (header: string): Promise<HTMLElement> => {
    const steps = await screen.findByLabelText('test steps');
    await within(steps).findByText(header);
    return steps;
  };

  it('heads the group with the claim sentence the corpus supplies', async () => {
    servedSteps = CLAIM_TAGGED_STEPS;
    renderTest(PASSING_ID, { claimTitles: { [CLAIM_ID]: CLAIMS[0] } });
    const steps = await findClaimHeader(CLAIMS[0]);
    // The id never leaks once the corpus names the claim.
    expect(within(steps).queryByText(CLAIM_ID)).not.toBeInTheDocument();
    // Only the untagged first step is preparation.
    expect(within(steps).getAllByText('Prepare')).toHaveLength(1);
  });

  it('falls back to the claim id when no corpus names it — never to "Prepare"', async () => {
    servedSteps = CLAIM_TAGGED_STEPS;
    renderTest(PASSING_ID);
    const steps = await findClaimHeader(CLAIM_ID);
    expect(within(steps).getAllByText('Prepare')).toHaveLength(1);
  });
});

describe('the SETUP section — the world the steps start in', () => {
  /**
   * The starting world a seeded, git-backed, env-carrying test declares. Composed
   * server-side off the same parse as the steps, so the page renders it and never
   * re-reads the file to learn what was already true at step 1.
   */
  const SETUP: GuardScenarioSetupView = {
    files: [
      { path: 'tasks.json', content: '[]' },
      { path: 'tasks.config.json', content: '{\n  "sort": "newest"\n}' },
    ],
    git: [
      'initializes a git repository in repo',
      'on branch trunk',
      'commits as Guard Runner <guard@example.com>',
      'commit 1 \u201cseed the store\u201d \u2014 tasks.json',
      'staged, uncommitted \u2014 tasks.config.json',
    ],
    env: ['NO_COLOR=1', 'TASKS_HOME=.tmp/tasks'],
  };

  /** The section's settle point — it lands with the same scenario-source fetch. */
  const findSetup = () => screen.findByLabelText('test setup');

  it('renders the seeded files COLLAPSED — the path is the row, the content one click', async () => {
    const user = userEvent.setup();
    servedSetup = SETUP;
    renderTest(PASSING_ID);
    const setup = await findSetup();

    // Every seeded path reads at a glance; not one of their bodies is on the page,
    // or a wall of config would bury the steps below.
    for (const file of SETUP.files!) {
      expect(within(setup).getByText(file.path)).toBeInTheDocument();
      expect(within(setup).queryByLabelText(`${file.path} contents`)).toBeNull();
    }

    await user.click(within(setup).getByRole('button', { name: 'Expand tasks.json' }));
    expect(within(setup).getByLabelText('tasks.json contents')).toHaveTextContent('[]');
    // Opening one opens only that one.
    expect(within(setup).queryByLabelText('tasks.config.json contents')).toBeNull();

    // …and it closes again from the same row.
    await user.click(within(setup).getByRole('button', { name: 'Collapse tasks.json' }));
    expect(within(setup).queryByLabelText('tasks.json contents')).toBeNull();
  });

  it('reads the git world and the env overlay as declared, one line each', async () => {
    servedSetup = SETUP;
    renderTest(PASSING_ID);
    const setup = await findSetup();

    for (const heading of ['Files', 'Git', 'Env']) {
      expect(within(setup).getByText(heading)).toBeInTheDocument();
    }
    for (const line of SETUP.git!) expect(within(setup).getByText(line)).toBeInTheDocument();
    for (const pair of SETUP.env!) expect(within(setup).getByText(pair)).toBeInTheDocument();
  });

  it('renders only the parts the scenario declares', async () => {
    servedSetup = { env: ['NO_COLOR=1'] };
    renderTest(PASSING_ID);
    const setup = await findSetup();
    expect(within(setup).getByText('NO_COLOR=1')).toBeInTheDocument();
    // No files and no git block ⇒ no headings promising either.
    expect(within(setup).queryByText('Files')).toBeNull();
    expect(within(setup).queryByText('Git')).toBeNull();
  });

  it('renders NOTHING at all for a test that declares no setup', async () => {
    renderTest(PASSING_ID);
    // The steps landed, so the source did — and it carried no setup: no section,
    // and no empty heading standing in for one.
    await findSteps();
    expect(screen.queryByLabelText('test setup')).toBeNull();
    expect(screen.queryByText('Setup')).toBeNull();
  });

  it('reads the world BEFORE the steps that run in it', async () => {
    servedSetup = SETUP;
    renderTest(PASSING_ID);
    const setup = await findSetup();
    const steps = await screen.findByLabelText('test steps');
    expect(setup.compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
