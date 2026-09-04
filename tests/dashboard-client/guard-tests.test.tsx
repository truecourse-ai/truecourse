/**
 * Guard TESTS-tab tests — the entity list of everything guard has committed, and
 * the ONE standalone destination for a single test.
 *
 * Covers the row model (`buildGuardTestRows`: the last run's outcome when a run
 * covered the test, else the status it was COMMITTED with — guard commits failing
 * tests, so a fresh clone lists its red tests as red), the LEFT PANEL (severity-led
 * rows reading "CLI test · Failing (birth)" plus the flow they serve), the DETAIL,
 * which reads in the order a reader asks: what it checks → the verdict band →
 * the steps → the Transcript and Interfaces records it can open, and the ONE
 * ruling the detail offers — "don't test this claim" on a FAILING result, scoped
 * to the failing milestone's claim (a passing test has nothing to rule on).
 *
 * The steps carry the failure: the diff (expected / actual / the program's output
 * excerpt) reads INSIDE the record of the step that failed, next to the claim that
 * step realizes — never as a top-level Expected/Actual pair, and never as a second
 * "Program output" section repeating the transcript below.
 *
 * EVERY step is one collapsible line and its record opens inline; the failing step
 * is the only one that starts open, per viewed result. The list itself carries no
 * group headers — a step's milestone reads in its own record.
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
  GuardInterfaceRow,
  GuardScenarioResult,
} from '@truecourse/shared';
import { GuardDriftList } from '@/components/guard/GuardDriftList';
import { GuardTestsPanel } from '@/components/guard/GuardTestsPanel';
import { GuardTestsPane } from '@/components/guard/GuardTestsPane';
import { useGuardDecisions } from '@/hooks/useGuardDecisions';
import { useGuardTestTabs } from '@/hooks/useGuardTestTabs';
import { buildGuardTestRows, type GuardTestFilter } from '@/lib/guard-tests';
import { GUARD_CLAMP_LINES } from '@/components/guard/GuardLongText';
import type { GuardLastRun, GuardScenarioRowData } from '@/hooks/useGuardScenarios';

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
    drivers: ['cli'],
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
    drivers: ['cli'],
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
    drivers: ['api'],
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
    drivers: ['cli'],
    lastResult: null,
  },
];

const ROWS = buildGuardTestRows(INVENTORY, FLOW_TITLES);

/** The run the outcomes were joined from — the overview's one last-run line. */
const LAST_RUN: GuardLastRun = {
  runId: RUN_ID,
  ranAt: '2026-07-24T14:02:00.000Z',
  commit: 'abcdef1234567890',
  branch: 'main',
  durationMs: 4200,
};

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
      interfacePath: ['cli/tasks-add'],
    },
  ],
  gaps: [],
  interfaceIds: ['cli/tasks-add'],
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
      interfacePath: [],
    },
  ],
  interfaceIds: [],
};

const INTERFACES: GuardInterfaceRow[] = [
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

const YAML = ['guard: 2', `id: ${PASSING_ID}`, 'driver: cli'].join('\n');
/**
 * The parsed step list the server ships alongside the source. A preparation step
 * annotated with NO milestone leads it, then two steps realizing milestone 1 and
 * one realizing milestone 2 — the grouping the detail renders as sections.
 */
const STEPS = [
  { n: 1, command: 'tasks init', expectation: 'exit 0' },
  { n: 2, command: 'tasks add "write the spec"', expectation: 'exit 0', milestone: 1 },
  {
    n: 3,
    command: 'tasks list',
    env: ['NO_COLOR=1'],
    expectation: 'exit 0 · stdout contains “write the spec”',
    milestone: 1,
  },
  { n: 4, command: 'tasks done 1', expectation: 'exit 0', milestone: 2 },
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

const decisionsBody = () => json({ version: 1, dismissedClaims, dismissedFlows: [] });

beforeEach(() => {
  dismissedClaims = [];
  fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/guard/flows/')) {
      return json(u.includes('pathological') ? BIRTH_FLOW_DETAIL : FLOW_DETAIL);
    }
    if (u.includes('/guard/scenario?'))
      return json({ id: PASSING_ID, file: 'x.yaml', content: YAML, driver: 'cli', steps: STEPS });
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

// --- The row model ---------------------------------------------------------

describe('buildGuardTestRows — the status a committed test carries', () => {
  const byId = (id: string) => ROWS.find((r) => r.id === id)!;

  it('prefers the last run over the status the test was committed with', () => {
    // A test committed passing that the last run failed reads Failing, from the run.
    expect(byId(RUN_FAILED_ID).status.plain).toBe('failing');
    expect(byId(RUN_FAILED_ID).status.birth).toBe(false);
    expect(byId(RUN_FAILED_ID).status.word).toBe('Failing');
    expect(byId(PASSING_ID).status.word).toBe('Passing');
  });

  it('paints a test committed RED red, with no run at all', () => {
    // The whole point of committing failing tests: a fresh clone tells the truth
    // before anyone runs anything.
    const row = byId(BIRTH_FAILED_ID);
    expect(row.status.plain).toBe('failing');
    expect(row.status.birth).toBe(true);
    expect(row.status.word).toBe('Failing (birth)');
  });

  it('leaves a never-run hand-written test un-judged rather than guessing', () => {
    expect(byId(MANUAL_ID).status.plain).toBe('passing');
    expect(byId(MANUAL_ID).handWritten).toBe(true);
  });

  it('orders severity-led — failing first, passing last', () => {
    expect(ROWS.map((r) => r.status.plain)).toEqual(['failing', 'failing', 'passing', 'passing']);
  });

  it('names the flow each test serves', () => {
    expect(byId(PASSING_ID).flowTitle).toBe(FLOW_TITLES.get(FLOW_ID));
    // A hand-written test belongs to no synthesized flow — it names itself.
    expect(byId(MANUAL_ID).flowTitle).toBe('`tasks --help` prints usage');
  });
});

// --- The left panel --------------------------------------------------------

/** The filter is owned ABOVE the panel (the overview's chips set the same one) —
 *  the harness plays that owner. */
function TestsPanelHarness(props: Partial<Parameters<typeof GuardTestsPanel>[0]> = {}) {
  const [filter, setFilter] = useState<GuardTestFilter>('all');
  return (
    <GuardTestsPanel
      tests={ROWS}
      loading={false}
      error={null}
      activeId={null}
      onOpen={() => {}}
      filter={filter}
      onFilter={setFilter}
      {...props}
    />
  );
}

describe('GuardTestsPanel — the test inventory', () => {
  const renderPanel = (props: Partial<Parameters<typeof GuardTestsPanel>[0]> = {}) =>
    render(<TestsPanelHarness {...props} />);

  const rows = () => within(screen.getByRole('list', { name: 'Test inventory' })).getAllByRole('listitem');

  it('reads "<surface> test · <status>" over the title, failing first', () => {
    renderPanel();
    const all = rows();
    expect(all).toHaveLength(ROWS.length);
    expect(within(all[0]).getByText('CLI test')).toBeInTheDocument();
    expect(within(all[0]).getByText('Failing (birth)')).toBeInTheDocument();
    expect(within(all[0]).getByText('Analyze completes despite a pathological slow file')).toBeInTheDocument();
    // The passing test closes the list.
    expect(within(all[all.length - 1]).getByText('Passing')).toBeInTheDocument();
  });

  it('carries NO flow line — a list row has one click target, and it opens the test', () => {
    // The flow line was a second target that navigated away from the list; the
    // flow now lives in the test DETAIL's footer.
    renderPanel();
    const list = screen.getByRole('list', { name: 'Test inventory' });
    expect(within(list).queryByText(FLOW_TITLES.get(FLOW_ID)!)).not.toBeInTheDocument();
    for (const row of rows()) expect(within(row).getAllByRole('button')).toHaveLength(1);
  });

  it('scrolls DOWN only — a long title or id is truncated, never widened into', () => {
    renderPanel();
    const list = screen.getByRole('list', { name: 'Test inventory' });
    // The list is the y-scroller and clips x: a row can never make it scroll
    // sideways (`overflow-auto` used to give the x axis away for free).
    expect(list.className).toContain('overflow-y-auto');
    expect(list.className).toContain('overflow-x-hidden');
    for (const row of rows()) {
      // The row and its click target shrink with the panel…
      expect(row.className, row.className).toContain('min-w-0');
      const button = within(row).getByRole('button');
      expect(button.className, button.className).toContain('min-w-0');
      // …and the TITLE wraps rather than truncating (a claim is a sentence), yet
      // stays width-bound, so it grows DOWN and never stretches the row.
      const title = within(row).getByText(/./, { selector: 'span.break-words' });
      expect(title.className).toContain('w-full');
      expect(title.className).toContain('min-w-0');
      expect(title.className).not.toContain('truncate');
    }
  });

  it('filters by the same four plain words the Flows tab uses', async () => {
    const user = userEvent.setup();
    renderPanel();
    const filter = screen.getByLabelText('Filter by status');
    expect(within(filter).getByRole('option', { name: 'Failing (2)' })).toBeInTheDocument();
    expect(within(filter).getByRole('option', { name: 'Passing (2)' })).toBeInTheDocument();
    await user.selectOptions(filter, 'failing');
    expect(rows()).toHaveLength(2);
    await user.type(screen.getByLabelText('Search tests'), 'pathological');
    expect(rows()).toHaveLength(1);
  });

  it('previews on single click and pins on double click', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderPanel({ onOpen });
    await user.click(screen.getByText('Tasks are created, listed newest-first, completed and filterable'));
    expect(onOpen).toHaveBeenCalledWith(PASSING_ID, false);
    await user.dblClick(screen.getByText('Tasks are created, listed newest-first, completed and filterable'));
    expect(onOpen).toHaveBeenCalledWith(PASSING_ID, true);
  });

  it('scrolls a deep-linked selection into view', () => {
    const scrolled: Element[] = [];
    const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element) {
      scrolled.push(this);
    });
    renderPanel({ activeId: MANUAL_ID });
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].textContent).toContain('`tasks --help` prints usage');
    spy.mockRestore();
  });
});

// --- ONE row component, two lists ------------------------------------------

describe('the shared test row — the Tests list and a run’s result list', () => {
  const PASSING_ROW = ROWS.find((r) => r.id === PASSING_ID)!;
  /** The same test, arriving as a RUN result instead of an inventory row. */
  const PASSING_RESULT: GuardScenarioResult = result(PASSING_ID, {
    title: PASSING_ROW.title,
    outcome: 'pass',
    durationMs: 412,
  });

  it('renders the same MARKUP in both lists for the same test and status', () => {
    const { unmount } = render(<TestsPanelHarness tests={[PASSING_ROW]} />);
    const testsRow = within(screen.getByRole('list', { name: 'Test inventory' })).getAllByRole('listitem')[0];
    const testsHtml = testsRow.outerHTML;
    unmount();

    render(
      <GuardDriftList drifts={[]} passed={[PASSING_RESULT]} activeId={null} onPreview={() => {}} onPin={() => {}} />,
    );
    const runRow = within(screen.getByRole('list', { name: 'Passed tests' })).getAllByRole('listitem')[0];
    expect(runRow.outerHTML).toBe(testsHtml);
    // Only the feeding result differs: the surface comes off the test id, the
    // status word off the outcome, and both read from the ONE vocabulary.
    expect(runRow).toHaveTextContent('CLI test');
    expect(runRow).toHaveTextContent('Passing');
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
    const row = within(screen.getByRole('list', { name: 'Failing tests' })).getAllByRole('listitem')[0];
    expect(row).toHaveTextContent('API test');
    expect(row).toHaveTextContent('Failing');
    expect(row).toHaveTextContent('Exporting writes every task to the file');
    // No duration, no failure snippet, no id line.
    expect(row.textContent).not.toMatch(/900ms|failed at milestone|500/);
    expect(row.textContent).not.toContain(RUN_FAILED_ID);
  });

  it('wraps the title — a claim is a sentence, and a row never cuts it', () => {
    render(<TestsPanelHarness tests={[PASSING_ROW]} />);
    const title = screen.getByText(PASSING_ROW.title);
    expect(title.className).toContain('break-words');
    expect(title.className).not.toContain('truncate');
    expect(title.className).not.toContain('line-clamp');
  });
});

// --- The pane: the one standalone test destination -------------------------

function TestsHarness({ onOpenFlow = () => {} }: { onOpenFlow?: (id: string) => void }) {
  const tabs = useGuardTestTabs('r');
  // The real decisions hook — the ruling's write path is under test, not a stub.
  const decisions = useGuardDecisions('r', true);
  const loc = useLocation();
  // The page owns the filter: the overview's chips and the panel's dropdown are
  // two controls over ONE narrowing.
  const [filter, setFilter] = useState<GuardTestFilter>('all');
  return (
    <div>
      <span data-testid="search">{loc.search}</span>
      <div data-testid="panel">
        <GuardTestsPanel
          tests={ROWS}
          loading={false}
          error={null}
          activeId={tabs.activeId}
          filter={filter}
          onFilter={setFilter}
          onOpen={tabs.open}
        />
      </div>
      <GuardTestsPane
        repoId="r"
        tests={ROWS}
        loading={false}
        error={null}
        runId={RUN_ID}
        lastRun={LAST_RUN}
        interfaces={INTERFACES}
        flowGoals={FLOW_GOALS}
        decisions={decisions}
        tabs={tabs}
        filter={filter}
        onFilter={setFilter}
        onOpenFlow={onOpenFlow}
        onOpenInterface={() => {}}
        onOpenSpec={() => {}}
      />
    </div>
  );
}

const renderPane = (url = '/repos/r?tab=tests') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <TestsHarness />
    </MemoryRouter>,
  );

const search = () => screen.getByTestId('search').textContent ?? '';

/**
 * The detail's settle point — BOTH of its fetches, rendered.
 *
 * `test steps` is a STABLE container: it renders from the first paint, holding
 * "Loading steps…", because a failure must read even for a file that never parses
 * into steps. Finding it therefore settles nothing. TWO fetches fill the page —
 * the scenario source brings the step ROWS, and the flow join brings the result
 * they are painted from (pass/fail/not-reached), the verdict band's failure line,
 * the evidence pointer and the milestone chain the opened records name. The join
 * lands FIRST here: it re-points the source read at the run (or the birth
 * evidence path), so the rows the join has not seen are replaced.
 */
async function findSteps(): Promise<HTMLElement> {
  // The flow join landed: the verdict band carries the joined result — the run's
  // duration on a pass, the failing step on a red. Neither exists before it.
  const band = screen.getByRole('region', { name: 'Test verdict' });
  await waitFor(() => expect(band).toHaveTextContent(/Failed at step|\d+ms/));
  const steps = await screen.findByLabelText('test steps');
  // The scenario source landed: the file's steps, not the loading line.
  await within(steps).findAllByRole('listitem');
  return steps;
}

/** The toggle of one step's collapsible record. */
const stepToggle = (steps: HTMLElement, n: number | 'setup') =>
  within(steps).getByRole('button', { name: n === 'setup' ? 'Setup record' : `Step ${n} record` });

/** One step's expanded record — the inline body under its row. */
const stepBody = (n: number | 'setup' | 'recorded') =>
  document.getElementById(`guard-step-body-${n}`) as HTMLElement;

/** Expand a step's record and return it. */
const openStep = async (user: ReturnType<typeof userEvent.setup>, steps: HTMLElement, n: number) => {
  await user.click(stepToggle(steps, n));
  return stepBody(n);
};

/** Open the supporting record's Transcript drawer — it is closed until asked for. */
const openTranscript = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /^Transcript/ }));
};

describe('GuardTestsPane — the test detail', () => {
  it('opening a test from the panel mirrors ?gtest and renders its detail', async () => {
    const user = userEvent.setup();
    renderPane();
    await user.click(
      within(screen.getByTestId('panel')).getByText(
        'Tasks are created, listed newest-first, completed and filterable',
      ),
    );
    expect(search()).toContain(`gtest=${encodeURIComponent(PASSING_ID)}`);
    expect(await findSteps()).toBeInTheDocument();
  });

  it('reads goal → verdict → steps → transcript → interfaces, in that order', async () => {
    const user = userEvent.setup();
    renderPane(`/repos/r?tab=tests&gtest=${PASSING_ID}`);
    const steps = await findSteps();

    // The page reads top-down in the order a reader asks: what it checks, the
    // verdict, the investigation, then the record they can open if they need it.
    const order = [
      screen.getByText(FLOW_GOALS.get(FLOW_ID)!),
      screen.getByRole('region', { name: 'Test verdict' }),
      steps,
      screen.getByRole('button', { name: /^Transcript/ }),
      screen.getByRole('button', { name: /^Interfaces/ }),
    ];
    const flat = Array.from(document.querySelectorAll('*'));
    const positions = order.map((el) => flat.indexOf(el));
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i], `element ${i} follows ${i - 1}`).toBeGreaterThan(positions[i - 1]);
    }

    // The verdict, then the steps as STEPS (not a YAML blob) and the transcript.
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.getByText('Latest state')).toBeInTheDocument();
    expect(within(steps).getAllByRole('listitem')).toHaveLength(STEPS.length);
    // The command reads in the STEP — asked of the page at large it is ambiguous,
    // since the transcript below opens on the same line.
    expect(within(steps).getByText('tasks add "write the spec"')).toBeInTheDocument();
    // …and the transcript arrives on its own fetch, read by opening its drawer.
    await openTranscript(user);
    await waitFor(() =>
      expect(screen.getByLabelText('evidence transcript')).toHaveTextContent('$ tasks add "write the spec"'),
    );
    // The interface path is the LAST record, and opens in place.
    await user.click(screen.getByRole('button', { name: /^Interfaces/ }));
    expect(screen.getByRole('region', { name: 'Interfaces used by this flow' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open interface cli/tasks-add' })).toBeInTheDocument();
  });

  // The status says the test is red; the chip says whose fault that
  // is, and the recommendation is the one line a reader acts on.
  it('carries the triage verdict beside the failure, with its unblock', async () => {
    renderPane(`/repos/r?tab=tests&gtest=${BIRTH_FAILED_ID}`);
    await findSteps();

    expect(screen.getByText('code drift')).toBeInTheDocument();
    expect(screen.getByText(/Bound the per-file work/)).toBeInTheDocument();
    // The verdict is a chip beside the status, never a replacement for it.
    expect(screen.getByText('Failed (birth)')).toBeInTheDocument();
  });

  it('a passing test carries no verdict chip — there is nothing to blame', async () => {
    renderPane(`/repos/r?tab=tests&gtest=${PASSING_ID}`);
    await findSteps();
    expect(screen.queryByText('code drift')).not.toBeInTheDocument();
    expect(screen.queryByText('our defect')).not.toBeInTheDocument();
  });

  it('slims the verdict to the RULING — where it broke and the claim, never the diff', async () => {
    renderPane(`/repos/r?tab=tests&gtest=${BIRTH_FAILED_ID}`);
    await findSteps();
    // The stage the failure came from, the step + milestone it broke at, and the
    // CLAIM behind that milestone. The diff itself reads at the step.
    expect(screen.getByText('Failed (birth)')).toBeInTheDocument();
    const card = screen.getByText(/Failed at step/).closest('div.rounded.border') as HTMLElement;
    expect(within(card).getByText(/milestone 1/)).toBeInTheDocument();
    expect(within(card).getByText(new RegExp(BIRTH_CLAIM.title))).toBeInTheDocument();
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
    renderPane(`/repos/r?tab=tests&gtest=${BIRTH_FAILED_ID}`);
    const steps = await findSteps();
    // The birth failure broke at step 2 of the four-step file.
    expect(within(steps).getByLabelText(/Step 1: .* — passed/)).toBeInTheDocument();
    expect(within(steps).getByLabelText(/Step 2: .* — failed/)).toBeInTheDocument();
    expect(within(steps).getByLabelText(/Step 3: .* — not reached/)).toBeInTheDocument();
    expect(within(steps).getByLabelText(/Step 4: .* — not reached/)).toBeInTheDocument();
    // A step reads as a step: its command on the closed line, and its env overlay
    // and what it expects inside the record that line opens.
    expect(within(steps).getByText('tasks list')).toBeInTheDocument();
    const third = await openStep(user, steps, 3);
    expect(within(third).getByText(/NO_COLOR=1/)).toBeInTheDocument();
    expect(within(third).getByLabelText('expected value')).toHaveTextContent('exit 0 · stdout contains');
  });

  it('makes EVERY step expandable, and opens the failing one', async () => {
    renderPane(`/repos/r?tab=tests&gtest=${BIRTH_FAILED_ID}`);
    const steps = await findSteps();
    // Every row is one toggle, and exactly one record starts open: the failure's.
    const open = within(steps).getAllByRole('button', { expanded: true });
    expect(open).toHaveLength(1);
    expect(open[0]).toHaveAccessibleName('Step 2 record');
    expect(within(stepBody(2)).getAllByLabelText('expected value')).toHaveLength(1);
    expect(within(steps).getAllByRole('button', { name: /^Step \d+ record$/ })).toHaveLength(STEPS.length);
  });

  it('closes the failing step on click, and opens it again', async () => {
    const user = userEvent.setup();
    renderPane(`/repos/r?tab=tests&gtest=${BIRTH_FAILED_ID}`);
    const steps = await findSteps();
    const toggle = stepToggle(steps, 2);

    // Open by default is a default, not a lock: the record puts away.
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('expected value')).toBeNull();
    expect(screen.queryByLabelText('actual value')).toBeNull();
    // The step itself never leaves — only its record did.
    expect(within(steps).getByLabelText(/Step 2: .* — failed/)).toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('expected value')).toBeInTheDocument();
  });

  it('tells a step’s expectation ONCE — the labelled field, not a summary', async () => {
    const user = userEvent.setup();
    renderPane(`/repos/r?tab=tests&gtest=${BIRTH_FAILED_ID}`);
    const steps = await findSteps();
    const failing = stepBody(2);
    // The labelled field says what it wanted…
    expect(within(failing).getByText('expected')).toBeInTheDocument();
    expect(within(failing).getByLabelText('expected value')).toHaveTextContent('exit 0');
    // …so the "expects …" summary line that would repeat it exists on no row at
    // all, open or closed. One rendering of one fact.
    await openStep(user, steps, 1);
    expect(within(steps).queryByText(/^expects/)).toBeNull();
  });

  it('reads the diff INSIDE the step that failed — and nowhere else', async () => {
    renderPane(`/repos/r?tab=tests&gtest=${BIRTH_FAILED_ID}`);
    const steps = await findSteps();
    const failing = stepBody(2);

    // What it wanted, what it got, and what the program printed — all at the step.
    expect(within(failing).getByText('expected')).toBeInTheDocument();
    expect(within(failing).getByLabelText('expected value')).toHaveTextContent('exit 0');
    expect(within(failing).getByLabelText('actual value')).toHaveTextContent('timed out after 120s');
    expect(within(failing).getByLabelText('step output')).toHaveTextContent('analyzing 4211 files');
    expect(within(failing).getByLabelText('step error output')).toHaveTextContent(
      'warning: pathological file skipped',
    );

    // Closed rows stay compact lines, so the diff exists only in the one open record.
    for (const row of within(steps).getAllByRole('listitem')) {
      if (row.contains(failing)) continue;
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

  it('a PASSING test starts with every record closed — and each opens inline', async () => {
    const user = userEvent.setup();
    renderPane(`/repos/r?tab=tests&gtest=${PASSING_ID}`);
    const steps = await findSteps();
    expect(within(steps).getAllByLabelText(/— passed/)).toHaveLength(STEPS.length);
    // Nothing failed, so nothing starts open — and no diff reads until asked for.
    expect(screen.queryByLabelText('expected value')).toBeNull();
    expect(screen.queryByLabelText('actual value')).toBeNull();
    expect(within(steps).queryAllByRole('button', { expanded: true })).toHaveLength(0);
    expect(within(steps).getAllByRole('button', { name: /^Step \d+ record$/ })).toHaveLength(STEPS.length);
    // Every row opens its own record, and a second opens BESIDE the first.
    const first = await openStep(user, steps, 1);
    expect(within(first).getByLabelText('expected value')).toHaveTextContent('exit 0');
    await openStep(user, steps, 2);
    expect(stepBody(1)).toBeInTheDocument();
    expect(stepBody(2)).toBeInTheDocument();
  });

  it('carries NO Program output section — the excerpt is the step’s, the streams are evidence', async () => {
    renderPane(`/repos/r?tab=tests&gtest=${BIRTH_FAILED_ID}`);
    await findSteps();
    // The section, and its stream sub-headings, are gone: the failing step's
    // excerpt and the one transcript below say all of it.
    expect(screen.queryByText('Program output')).toBeNull();
    expect(screen.queryByText(/^stdout$/i)).toBeNull();
    expect(screen.queryByText(/^stderr$/i)).toBeNull();
  });

  it('reads a step’s claim inside its record — the list carries no group headers', async () => {
    const user = userEvent.setup();
    renderPane(`/repos/r?tab=tests&gtest=${PASSING_ID}`);
    const steps = await findSteps();
    // No divider rows: the closed list is steps alone, in file order.
    expect(within(steps).queryByText('Setup')).toBeNull();
    expect(within(steps).queryByText('Milestone 1')).toBeNull();
    for (const claim of CLAIMS) expect(within(steps).queryByText(new RegExp(claim))).toBeNull();
    expect(within(steps).getAllByRole('listitem')).toHaveLength(STEPS.length);
    // The claim reads inside the record of the step that realizes it, named by
    // the milestone AND its sentence.
    const second = await openStep(user, steps, 2);
    expect(within(second).getByText(`Milestone 1 — ${CLAIMS[0]}`)).toBeInTheDocument();
    const fourth = await openStep(user, steps, 4);
    expect(within(fourth).getByText(`Milestone 2 — ${CLAIMS[1]}`)).toBeInTheDocument();
    // The tag that used to ride each closed row is gone.
    expect(within(steps).queryByText(/^milestone \d+$/)).toBeNull();
  });

  it('names a milestone the flow does not know by its number alone', async () => {
    const user = userEvent.setup();
    // The birth flow declares milestone 1 only; the file's step 4 realizes 2.
    renderPane(`/repos/r?tab=tests&gtest=${BIRTH_FAILED_ID}`);
    const steps = await findSteps();
    // A milestone the flow DOES name reads its claim in the open record…
    expect(within(stepBody(2)).getByText(new RegExp(`Milestone 1 — ${BIRTH_CLAIM.title}`))).toBeInTheDocument();
    // …and the one it does not is its number alone — never a borrowed claim.
    const fourth = await openStep(user, steps, 4);
    expect(within(fourth).getByText('Milestone 2')).toBeInTheDocument();
  });

  it('switches between the page and the raw file, and defaults to the page', async () => {
    const user = userEvent.setup();
    renderPane(`/repos/r?tab=tests&gtest=${PASSING_ID}`);
    await findSteps();
    const modes = screen.getByRole('group', { name: 'View mode' });
    expect(within(modes).getByRole('button', { name: 'View' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('test source')).not.toBeInTheDocument();

    await user.click(within(modes).getByRole('button', { name: 'YAML' }));
    // The whole file, in the pane's own scroll context — no clamp, no expander.
    // The block is stable like the step container is: it renders the moment the
    // mode flips, holding "Loading…" until the source lands — so the wait is for
    // the CONTENT, never for the element.
    await waitFor(() => expect(screen.getByLabelText('test source')).toHaveTextContent('guard: 2'));
    expect(screen.queryByLabelText('test steps')).not.toBeInTheDocument();
    expect(screen.queryByText(/Show all \d+ lines/)).not.toBeInTheDocument();

    await user.click(within(modes).getByRole('button', { name: 'View' }));
    expect(await findSteps()).toBeInTheDocument();
  });

  it('closes with LABELLED footer rows — no fingerprints, no source affordance', async () => {
    renderPane(`/repos/r?tab=tests&gtest=${PASSING_ID}`);
    await findSteps();
    for (const label of ['Test', 'File', 'Flow', 'Spec']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('x.yaml')).toBeInTheDocument();
    expect(screen.queryByText('View source')).not.toBeInTheDocument();
    expect(screen.queryByText(/sha256/)).not.toBeInTheDocument();
  });

  it('clamps a long transcript and grows it INLINE — never a vertical scroll box', async () => {
    const user = userEvent.setup();
    renderPane(`/repos/r?tab=tests&gtest=${PASSING_ID}`);
    await findSteps();
    await openTranscript(user);
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
    // Nothing between the block and its pane scrolls: the pane is the only scroll
    // context any block on this page has, and it is marked as one.
    for (let el = block.parentElement; el && el.tagName !== 'BODY'; el = el.parentElement) {
      if (el.hasAttribute('data-pane')) break;
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
    const user = userEvent.setup();
    renderPane(`/repos/r?tab=tests&gtest=${BIRTH_FAILED_ID}`);
    await findSteps();
    await openTranscript(user);
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
    const pane = screen.getByLabelText('evidence transcript').closest('[data-pane]') as HTMLElement;
    expect(pane).not.toBeNull();
    expect(pane.className).toContain('overflow-y-auto');
    expect(pane.className).toContain('overflow-x-hidden');
  });

  it('marks a test that failed at BIRTH and reads its birth transcript', async () => {
    const user = userEvent.setup();
    renderPane(`/repos/r?tab=tests&gtest=${BIRTH_FAILED_ID}`);
    // The status word reads off the INVENTORY, before either fetch lands — the
    // failure it belongs to is the flow join's, so the page must settle first.
    await findSteps();
    expect(screen.getByText('Failed (birth)')).toBeInTheDocument();
    expect(within(stepBody(2)).getByLabelText('actual value')).toHaveTextContent('timed out after 120s');
    // A birth failure's transcript is addressed by its stored path, not by a run.
    await openTranscript(user);
    expect(await screen.findByText(/analyze \./)).toBeInTheDocument();
  });

  it('a legacy ?gscn deep link resolves to the same destination', async () => {
    renderPane(`/repos/r?tab=tests&gscn=${PASSING_ID}`);
    expect(await findSteps()).toBeInTheDocument();
    // The title reads in both the panel row and the detail header.
    expect(
      screen.getAllByText('Tasks are created, listed newest-first, completed and filterable').length,
    ).toBeGreaterThanOrEqual(2);
  });

  it('jumps from the detail to the flow the test serves', async () => {
    const user = userEvent.setup();
    const onOpenFlow = vi.fn();
    render(
      <MemoryRouter initialEntries={[`/repos/r?tab=tests&gtest=${PASSING_ID}`]}>
        <TestsHarness onOpenFlow={onOpenFlow} />
      </MemoryRouter>,
    );
    await findSteps();
    // The flow is a FOOTER jump in the detail — the list rows carry none.
    const buttons = screen.getAllByRole('button', { name: new RegExp(FLOW_TITLES.get(FLOW_ID)!.slice(0, 20)) });
    expect(buttons).toHaveLength(1);
    await user.click(buttons[buttons.length - 1]);
    expect(onOpenFlow).toHaveBeenCalledWith(FLOW_ID);
  });

  it('says so honestly when the id is not in the committed corpus', async () => {
    renderPane('/repos/r?tab=tests&gtest=gone.cli.1');
    expect(await screen.findByText('Test not found')).toBeInTheDocument();
  });

  it('shows the corpus overview when no test is open — counts, the birth/run split, the last run', () => {
    renderPane();
    const overview = screen.getByRole('region', { name: 'Tests overview' });
    const chips = within(overview).getByRole('group', { name: 'Test filters' });
    expect(within(chips).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '4tests',
      '2passing',
      '2failing',
    ]);
    // The failures split by the stage that produced them.
    expect(within(overview).getByText('Failing: 1 at birth · 1 in the last run')).toBeInTheDocument();
    // ONE last-run line: when · commit · duration.
    expect(within(overview).getByText(/abcdef12 · 4\.2s/)).toBeInTheDocument();
    // The one thing the rows can't say stays.
    expect(within(overview).getByText(/Guard commits every test it writes/)).toBeInTheDocument();
  });

  it('an overview chip filters the LIST — the same narrowing the dropdown drives', async () => {
    const user = userEvent.setup();
    renderPane();
    const chips = within(screen.getByRole('region', { name: 'Tests overview' })).getByRole('group', {
      name: 'Test filters',
    });
    const panel = () => within(screen.getByTestId('panel'));
    const listRows = () => panel().queryAllByRole('listitem');

    await user.click(within(chips).getByRole('button', { name: '2 failing' }));
    expect(listRows()).toHaveLength(2);
    expect((panel().getByLabelText('Filter by status') as HTMLSelectElement).value).toBe('failing');

    await user.click(within(chips).getByRole('button', { name: '4 tests' }));
    expect(listRows()).toHaveLength(ROWS.length);
    expect((panel().getByLabelText('Filter by status') as HTMLSelectElement).value).toBe('all');
  });
});

// --- The ruling: "don't test this claim" -----------------------------------

describe('GuardTestsPane — ruling a failing test’s claim out of testing', () => {
  const RULE = "Don't test this claim";
  const postsTo = (path: string) =>
    fetchMock.mock.calls.filter((c) => String(c[0]).includes(path)).map((c) => c[1] as RequestInit);

  it('a FAILING test offers the ruling, keyed on the failing milestone’s claim', async () => {
    const user = userEvent.setup();
    renderPane(`/repos/r?tab=tests&gtest=${BIRTH_FAILED_ID}`);
    await findSteps();

    await user.click(await screen.findByRole('button', { name: RULE }));

    const writes = postsTo('/guard/dismiss');
    expect(writes).toHaveLength(1);
    // The payload is the MILESTONE's binding + claim text, not the test's title.
    expect(JSON.parse(String(writes[0].body))).toEqual(BIRTH_CLAIM);
    // The write's answer lands immediately — no reload to see the new state.
    expect(await screen.findByText(/This claim is dismissed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RULE })).toBeNull();
  });

  it('a PASSING test offers nothing — there is no claim to rule on', async () => {
    renderPane(`/repos/r?tab=tests&gtest=${PASSING_ID}`);
    await findSteps();
    expect(screen.getByText('Passed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RULE })).toBeNull();
  });

  it('an already-dismissed claim reads as dismissed, and undo puts it back', async () => {
    const user = userEvent.setup();
    dismissedClaims = [{ ...BIRTH_CLAIM, dismissedAt: '2026-07-25T10:00:00.000Z' }];
    renderPane(`/repos/r?tab=tests&gtest=${BIRTH_FAILED_ID}`);

    expect(await screen.findByText(/This claim is dismissed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: RULE })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'undo' }));

    const writes = postsTo('/guard/undismiss');
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0].body))).toEqual(BIRTH_CLAIM);
    expect(await screen.findByRole('button', { name: RULE })).toBeInTheDocument();
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
    renderPane(`/repos/r?tab=tests&gtest=${BIRTH_FAILED_ID}`);

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
