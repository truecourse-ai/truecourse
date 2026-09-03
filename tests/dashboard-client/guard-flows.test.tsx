/**
 * Guard FLOWS-tab tests, on the governing model:
 *
 *   a flow either has a test or it doesn't. Has one → show the test and its
 *   status. Doesn't → say why, in one plain sentence.
 *
 * Covers the LEFT PANEL (ONE flat list, failing flows first, every row carrying
 * title + goal + exactly ONE status word over the whole coverage-status domain),
 * the FLOW DETAIL (the milestone graph in generate paint, and ONE row per surface
 * — the test, clickable through to the Tests tab, or the why-no-test sentence,
 * with NO gaps block, NO findings block and NO authoring-errors block), and the
 * RUNS tab's flow instance (execution paint + the "open this test" link).
 *
 * The fixture is the plan's worked example, "taskbird", plus the shapes the
 * 2026-07-26 live review caught rendering wrong: a flow whose only news was a
 * birth failure, a flow whose blocked reason is a paragraph, an ERROR-only flow
 * (which must read Not generated — nothing ran, so nothing failed), and a
 * committed failing test that has to be clickable.
 */

import { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { GUARD_COVERAGE_STATUS_PRECEDENCE } from '@truecourse/shared';
import type {
  GuardFlowBucket,
  GuardFlowDetail as GuardFlowDetailData,
  GuardFlowListItem,
  GuardFlowsView,
  GuardGenerateReport,
  GuardRunFlow,
  GuardScenarioResult,
  GuardSectionCoverageStatus,
} from '@truecourse/shared';
import { GuardFlowsPanel } from '@/components/guard/GuardFlowsPanel';
import { GuardFlowsPane } from '@/components/guard/GuardFlowsPane';
import { GuardFlowDetail } from '@/components/guard/GuardFlowDetail';
import { GuardDriftDetail } from '@/components/guard/GuardDriftDetail';
import { useGuardFlowTabs } from '@/hooks/useGuardFlowTabs';
import { useGuardDecisions } from '@/hooks/useGuardDecisions';
import {
  GUARD_FLOW_FILTER_ORDER,
  GUARD_FLOW_STATUS_WORD,
  guardPlainStatus,
  guardStatusHint,
  guardStatusLabel,
  guardStatusWord,
  type GuardFlowFilter,
} from '@/lib/guard-flow-status';
import { guardStatusMeta } from '@/lib/guard-status';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const DOC = 'docs/specs/tasks.md';
const FLOW_ID = 'task-lifecycle';
const SCENARIO_ID = 'task-lifecycle.cli.1';
const MANUAL_ID = 'tasks-help-smoke';
const RUN_ID = '2026-07-24T14-02-00Z_9f31c0aa';
const FLOW_TITLE = 'A user creates a task, sees it listed, completes it, and sees it done';

const CLI_SURFACE = {
  surface: 'cli' as const,
  scenarioId: SCENARIO_ID,
  status: 'fail' as const,
  outcome: 'fail' as const,
  stage: 'run' as const,
  interfaceDrifted: true,
};
const WEB_GAP = {
  surface: 'web' as const,
  status: 'tui' as const,
  gap: {
    kind: 'awaiting-driver' as const,
    driver: 'web' as const,
    reason: 'the board is browser-only',
    label: 'awaiting tui driver',
  },
};

const FLOWS: GuardFlowListItem[] = [
  {
    flowId: FLOW_ID,
    title: FLOW_TITLE,
    goal: 'Create, list, complete and filter a task from the CLI',
    status: 'fail',
    bucket: 'partial',
    epic: false,
    composedOf: [],
    manual: false,
    milestoneCount: 4,
    sectionCount: 3,
    docs: [DOC],
    surfaces: [CLI_SURFACE, WEB_GAP],
    findings: 0,
    toolDefects: 0,
    errors: 0,
    interfaceDrifted: true,
  },
  {
    flowId: 'task-export',
    title: 'A user exports the task list',
    goal: 'Export tasks to a file from the CLI',
    status: 'no-interface',
    bucket: 'blocked',
    epic: false,
    composedOf: [],
    manual: false,
    milestoneCount: 1,
    sectionCount: 1,
    docs: [DOC],
    surfaces: [
      {
        surface: 'cli',
        status: 'no-interface',
        gap: { kind: 'no-interface', reason: 'no cli journey exports the list', label: 'no journey' },
      },
    ],
    findings: 0,
    toolDefects: 0,
    errors: 0,
    interfaceDrifted: false,
  },
  {
    // Authoring never started: the repo declares no API preparation and no
    // credentials, so the flow states both needs in plain words — in its DETAIL.
    flowId: 'task-remind',
    title: 'A user schedules a reminder',
    goal: 'Schedule a reminder over the API',
    status: 'blocked-on',
    bucket: 'blocked',
    epic: false,
    composedOf: [],
    manual: false,
    milestoneCount: 2,
    sectionCount: 1,
    docs: [DOC],
    surfaces: [
      {
        surface: 'api',
        status: 'blocked-on',
        gap: {
          kind: 'blocked-on',
          reason: 'blocked on a recipe `api` block, credentials: A user schedules a reminder',
          label: 'blocked-on',
        },
      },
    ],
    findings: 0,
    toolDefects: 0,
    errors: 0,
    interfaceDrifted: false,
  },
  {
    flowId: `manual:${MANUAL_ID}`,
    title: '`tasks --help` prints usage',
    goal: '',
    status: 'pass',
    bucket: 'guarded',
    epic: false,
    composedOf: [],
    manual: true,
    milestoneCount: 0,
    sectionCount: 1,
    docs: [DOC],
    surfaces: [{ surface: 'cli', scenarioId: MANUAL_ID, status: 'pass', outcome: 'pass', stage: 'run' }],
    findings: 0,
    toolDefects: 0,
    errors: 0,
    interfaceDrifted: false,
  },
];

/**
 * Regression fixtures — the rows the 2026-07-26 live review caught.
 *
 * `BIRTH_FAILED_FLOW` mirrors `handle-pathological-files-without-freezing-analyze`.
 * Guard now COMMITS a test that fails at birth, so the flow arrives with a real
 * surface carrying `stage: 'birth'` and `status: 'fail'`: the row must read
 * Failing, and the test itself must be clickable in the detail.
 *
 * `ERROR_ONLY_FLOW` is the other half of that pair: authoring ERRORED, so no test
 * exists and NOTHING ran. It must never read Failing — a failure is a result, and
 * there is no result here.
 *
 * `LONG_BLOCKED_FLOW` mirrors `resolve-spec-conflicts-before-generating-guard-scenarios`:
 * a `blocked-on` reason naming three capabilities AND restating the flow goal —
 * the paragraph that leaked into a list row.
 */
const BIRTH_FAILED_ID = 'handle-pathological-files.cli.1';
const BIRTH_FAILED_FLOW: GuardFlowListItem = {
  flowId: 'handle-pathological-files-without-freezing-analyze',
  title: 'Analyze completes despite a pathological slow file',
  goal: 'Analyze a repo carrying a pathological file without freezing',
  status: 'fail',
  bucket: 'guarded',
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 1,
  sectionCount: 1,
  docs: ['README.md'],
  surfaces: [{ surface: 'cli', scenarioId: BIRTH_FAILED_ID, status: 'fail', stage: 'birth' }],
  findings: 1,
  toolDefects: 0,
  errors: 0,
  interfaceDrifted: false,
};

const ERROR_ONLY_FLOW: GuardFlowListItem = {
  flowId: 'stream-analyze-progress',
  title: 'Analyze streams its progress',
  goal: 'Watch analyze tick through its stages',
  status: 'unguarded',
  bucket: 'blocked',
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 2,
  sectionCount: 1,
  docs: ['README.md'],
  surfaces: [],
  findings: 0,
  toolDefects: 0,
  errors: 2,
  interfaceDrifted: false,
};

const LONG_BLOCKED_REASON =
  'blocked on llm-provider, credentials, network: Curate the spec corpus and resolve conflicts before generating guard scenarios';

const LONG_BLOCKED_FLOW: GuardFlowListItem = {
  flowId: 'resolve-spec-conflicts-before-generating-guard-scenarios',
  title: 'Resolve spec conflicts before generating',
  goal: 'Curate the spec corpus, then generate',
  status: 'blocked-on',
  bucket: 'blocked',
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 2,
  sectionCount: 2,
  docs: ['docs/SPEC_GUARD_PLAN.md'],
  surfaces: [
    {
      surface: 'cli',
      status: 'blocked-on',
      gap: { kind: 'blocked-on', reason: LONG_BLOCKED_REASON, label: 'blocked-on' },
    },
  ],
  findings: 0,
  toolDefects: 0,
  errors: 0,
  interfaceDrifted: false,
};

/**
 * The exact wire payload the 2026-07-27 review caught: a blocked flow whose ONE
 * cli surface carries a `blocked-on` gap naming two capabilities and NO
 * scenarioId — the row that wore two words ("Blocked" in the list, "Needs setup"
 * in the detail) and looked like a test while being unclickable.
 */
const CONFLICTS_FLOW_ID = 'review-and-resolve-spec-conflicts';
const CONFLICTS_GAP = {
  kind: 'blocked-on' as const,
  reason: 'blocked on credentials, network: Review and resolve spec conflicts',
  label: 'blocked-on',
};
const CONFLICTS_FLOW: GuardFlowListItem = {
  flowId: CONFLICTS_FLOW_ID,
  title: 'A maintainer reviews and resolves spec conflicts',
  goal: 'Resolve every open conflict before generating',
  status: 'blocked-on',
  bucket: 'blocked',
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 3,
  sectionCount: 2,
  docs: ['docs/SPEC_GUARD_PLAN.md'],
  surfaces: [{ surface: 'cli', status: 'blocked-on', gap: CONFLICTS_GAP }],
  findings: 0,
  toolDefects: 0,
  errors: 0,
  interfaceDrifted: false,
};

/**
 * The flow the specs no longer derive: recomposition dropped it from
 * `flows.json`, so it has NO title, NO goal and NO milestones — only its
 * committed test keeps it alive. Everything a reader sees about it has to come
 * from the one sentence, because the corpus that described it is gone.
 */
const UNDERIVED_ID = 'purge-tasks';
const UNDERIVED_TEST_ID = 'purge-tasks.cli.1';
const UNDERIVED_FLOW: GuardFlowListItem = {
  flowId: UNDERIVED_ID,
  title: UNDERIVED_ID,
  goal: '',
  status: 'pass',
  bucket: 'guarded',
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 0,
  sectionCount: 1,
  docs: [DOC],
  surfaces: [{ surface: 'cli', scenarioId: UNDERIVED_TEST_ID, status: 'pass', outcome: 'pass', stage: 'run' }],
  findings: 0,
  toolDefects: 0,
  errors: 0,
  interfaceDrifted: false,
  orphaned: true,
};

const VIEW: GuardFlowsView = {
  flows: FLOWS,
  totals: { total: 4, guarded: 1, partial: 1, blocked: 2, ungenerated: 0, manual: 1 },
  noFlowClaims: 1,
  synthesized: true,
  generatedAt: '2026-07-24T13:40:00.000Z',
  runId: RUN_ID,
  ranAt: '2026-07-24T14:02:00.000Z',
  recipe: {
    surfaces: { cli: { build: 'pnpm build', entry: ['node', 'dist/tasks.js'] } },
    fingerprint: 'sha256:9f2caabbccdd',
    stale: false,
  },
};

const REPORT: GuardGenerateReport = {
  generatedAt: '2026-07-24T13:40:00.000Z',
  status: 'ok',
  sectionsTotal: 4,
  sectionsChanged: 3,
  skippedUnchanged: 1,
  noChanges: false,
  written: [
    {
      id: SCENARIO_ID,
      title: 'Tasks are created, listed, completed',
      doc: DOC,
      anchor: 'tasks/creating-tasks',
      file: 'tasks.yaml',
      status: 'passing',
    },
    {
      id: BIRTH_FAILED_ID,
      title: 'Analyze completes despite a pathological slow file',
      doc: 'README.md',
      anchor: 'analyze',
      file: 'pathological.yaml',
      status: 'failing',
    },
  ],
  coverageGaps: [],
  birthFindings: [],
  errors: [],
  extractionFailures: [],
  orphaned: [],
  flows: {
    total: 6,
    settled: 5,
    unsettled: 1,
    skipped: 0,
    dismissed: 0,
    orphaned: 0,
    subsumed: 0,
    noFlowClaims: 1,
    unsettledAreas: [],
  },
  usage: { calls: 12, inputTokens: 120_000, outputTokens: 8_000, costUsd: 3.5 },
};

const DETAIL: GuardFlowDetailData = {
  flowId: FLOW_ID,
  title: FLOW_TITLE,
  goal: 'Create, list, complete and filter a task from the CLI',
  status: 'fail',
  bucket: 'partial',
  epic: false,
  manual: false,
  composedOf: [],
  fingerprint: 'sha256:41ac',
  milestones: [
    {
      order: 1,
      doc: DOC,
      anchor: 'tasks/creating-tasks',
      claimTitle: 'Creating a task prints its id',
      headingText: 'Creating tasks',
      live: true,
      drifted: false,
    },
    {
      order: 2,
      doc: DOC,
      anchor: 'tasks/listing-tasks',
      claimTitle: 'The list shows tasks newest-first',
      headingText: 'Listing tasks',
      live: true,
      // The bound section was edited since synthesis — the drift paint.
      drifted: true,
    },
    {
      order: 3,
      doc: DOC,
      anchor: 'tasks/completing-tasks',
      claimTitle: 'A task can be marked done',
      headingText: 'Completing tasks',
      live: true,
      drifted: false,
    },
    {
      order: 4,
      doc: DOC,
      anchor: 'tasks/completing-tasks',
      claimTitle: 'Done tasks appear under --done',
      headingText: 'Completing tasks',
      live: true,
      drifted: false,
    },
  ],
  surfaces: [
    {
      surface: 'cli',
      scenarioId: SCENARIO_ID,
      title: 'Tasks are created, listed newest-first, completed and filterable',
      file: '.truecourse/scenarios/tasks/task-lifecycle.cli.1.yaml',
      status: 'fail',
      birthPassed: true,
      stage: 'run',
      outcome: 'fail',
      durationMs: 412,
      failure: { step: 3, expected: 'exit 0', actual: 'exit 1: unknown command `done`' },
      failedMilestone: 3,
      interfaceDrifted: true,
      evidencePath: `.truecourse/guard/evidence/${RUN_ID}/${SCENARIO_ID}`,
      hasEvidence: true,
      interfacePath: ['cli/tasks-add', 'cli/tasks-list', 'cli/tasks-done'],
    },
    { surface: 'web', status: 'tui', birthPassed: false, hasEvidence: false, interfacePath: [], gap: WEB_GAP.gap },
  ],
  gaps: [{ surface: 'web', ...WEB_GAP.gap }],
  interfaceIds: ['cli/tasks-add', 'cli/tasks-list', 'cli/tasks-done'],
  findings: [],
  errors: [],
  generatedAt: '2026-07-24T13:40:00.000Z',
  runId: RUN_ID,
  ranAt: '2026-07-24T14:02:00.000Z',
};

/** The committed-failing-test detail — the review's "unclickable failing test". */
const BIRTH_FAILED_DETAIL: GuardFlowDetailData = {
  ...DETAIL,
  flowId: BIRTH_FAILED_FLOW.flowId,
  title: BIRTH_FAILED_FLOW.title,
  goal: BIRTH_FAILED_FLOW.goal,
  status: 'fail',
  bucket: 'guarded',
  milestones: [DETAIL.milestones[0]],
  surfaces: [
    {
      surface: 'cli',
      scenarioId: BIRTH_FAILED_ID,
      title: 'Analyze completes despite a pathological slow file',
      status: 'fail',
      birthPassed: false,
      stage: 'birth',
      failure: { step: 2, expected: 'exit 0', actual: 'timed out after 120s' },
      hasEvidence: true,
      interfacePath: [],
    },
  ],
  gaps: [],
  interfaceIds: [],
  findings: [],
  errors: [],
};

/** The error-only detail: no test, no gap — authoring could not finish. The read
 *  side paints such a surface `authoring-error`, so the row carries that status. */
const ERROR_ONLY_DETAIL: GuardFlowDetailData = {
  ...DETAIL,
  flowId: ERROR_ONLY_FLOW.flowId,
  title: ERROR_ONLY_FLOW.title,
  goal: ERROR_ONLY_FLOW.goal,
  status: 'authoring-error',
  bucket: 'blocked',
  milestones: [DETAIL.milestones[0]],
  surfaces: [{ surface: 'cli', status: 'authoring-error', birthPassed: false, hasEvidence: false, interfacePath: [] }],
  gaps: [],
  interfaceIds: [],
  findings: [],
  errors: [
    {
      doc: 'README.md',
      anchor: 'analyze',
      kind: 'authoring',
      surface: 'cli',
      message: 'the model returned an unparseable envelope',
    },
  ],
};

/** Nothing attempted yet: no test, no gap — and no error either. */
const NOT_ATTEMPTED_DETAIL: GuardFlowDetailData = {
  ...ERROR_ONLY_DETAIL,
  flowId: 'not-attempted',
  status: 'unguarded',
  surfaces: [],
  errors: [],
};

const UNDERIVED_DETAIL: GuardFlowDetailData = {
  ...DETAIL,
  flowId: UNDERIVED_ID,
  title: UNDERIVED_ID,
  goal: '',
  status: 'pass',
  bucket: 'guarded',
  milestones: [],
  surfaces: [
    {
      surface: 'cli',
      scenarioId: UNDERIVED_TEST_ID,
      title: 'Purged tasks leave the list',
      status: 'pass',
      birthPassed: true,
      stage: 'run',
      outcome: 'pass',
      hasEvidence: false,
      interfacePath: [],
    },
  ],
  gaps: [],
  interfaceIds: [],
  findings: [],
  errors: [],
  orphaned: true,
};

const CONFLICTS_DETAIL: GuardFlowDetailData = {
  ...DETAIL,
  flowId: CONFLICTS_FLOW_ID,
  title: CONFLICTS_FLOW.title,
  goal: CONFLICTS_FLOW.goal,
  status: 'blocked-on',
  bucket: 'blocked',
  milestones: [DETAIL.milestones[0]],
  surfaces: [
    { surface: 'cli', status: 'blocked-on', birthPassed: false, hasEvidence: false, interfacePath: [], gap: CONFLICTS_GAP },
  ],
  gaps: [{ surface: 'cli', ...CONFLICTS_GAP }],
  interfaceIds: [],
  findings: [],
  errors: [],
};

const SCENARIO_YAML = ['guard: 2', `id: ${SCENARIO_ID}`, 'driver: cli'].join('\n');
const TRANSCRIPT = '$ tasks done 1\nunknown command `done`';

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/guard/flows/')) {
        if (u.includes(ERROR_ONLY_FLOW.flowId)) return json(ERROR_ONLY_DETAIL);
        if (u.includes(BIRTH_FAILED_FLOW.flowId)) return json(BIRTH_FAILED_DETAIL);
        return json(DETAIL);
      }
      if (u.includes('/guard/scenario?')) return json({ id: SCENARIO_ID, file: 'x.yaml', content: SCENARIO_YAML });
      if (u.includes('/guard/evidence')) return new Response(TRANSCRIPT, { status: 200 });
      return json({});
    }),
  );
}

beforeEach(stubFetch);
afterEach(() => vi.unstubAllGlobals());

// --- The left panel --------------------------------------------------------

/**
 * The panel's filter is owned ABOVE it (the page holds it, so the overview's
 * chips and this dropdown are two controls over one narrowing) — the harness
 * plays that owner.
 */
function FlowsPanelHarness(props: Partial<Parameters<typeof GuardFlowsPanel>[0]> = {}) {
  const [filter, setFilter] = useState<GuardFlowFilter>('all');
  return (
    <GuardFlowsPanel
      flows={FLOWS}
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

describe('GuardFlowsPanel — the flow inventory', () => {
  const renderPanel = (props: Partial<Parameters<typeof GuardFlowsPanel>[0]> = {}) =>
    render(<FlowsPanelHarness {...props} />);

  /** The list rows in render order, as text. */
  const rowTexts = () =>
    within(screen.getByRole('list', { name: 'Flow inventory' }))
      .getAllByRole('listitem')
      .map((row) => row.textContent ?? '');

  it('is ONE flat list — no grouping chrome, failing flows first', () => {
    renderPanel();
    const list = screen.getByRole('list', { name: 'Flow inventory' });
    expect(within(list).queryByRole('button', { expanded: true })).not.toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(FLOWS.length);
    const texts = rowTexts();
    expect(texts[0]).toContain(FLOW_TITLE);
    expect(texts[texts.length - 1]).toContain('`tasks --help` prints usage');
  });

  it('renders every row the same way — title, goal, chips and counts', () => {
    renderPanel();
    const list = screen.getByRole('list', { name: 'Flow inventory' });
    const failing = within(list).getByText(FLOW_TITLE).closest('[role="listitem"]')!;
    const passing = within(list)
      .getByText('`tasks --help` prints usage')
      .closest('[role="listitem"]')!;
    expect(within(failing as HTMLElement).getByText(FLOWS[0].goal)).toBeInTheDocument();
    expect(within(failing as HTMLElement).getByText('CLI ✗')).toBeInTheDocument();
    // The surface chip names the surface only — what it NEEDS is detail copy.
    expect(within(failing as HTMLElement).getByText('Web')).toBeInTheDocument();
    // No tally line: milestone / section counts are detail copy, lists stay lean.
    expect(within(list).queryByText(/milestones? ·/)).not.toBeInTheDocument();
    expect(within(passing as HTMLElement).getByText('CLI ✓')).toBeInTheDocument();
    expect((failing as HTMLElement).className).toBe((passing as HTMLElement).className);
    expect(within(list).getByText('manual')).toBeInTheDocument();
  });

  it('a row for a flow the specs no longer derive carries the same sentence, not a bare id', () => {
    renderPanel({ flows: [...FLOWS, UNDERIVED_FLOW] });
    const list = screen.getByRole('list', { name: 'Flow inventory' });
    const row = within(list).getByText(UNDERIVED_ID).closest('[role="listitem"]')! as HTMLElement;
    expect(
      within(row).getByText('No longer derived from your specs — kept because its test still runs.'),
    ).toBeInTheDocument();
    // Every other row keeps its own goal — the sentence only fills an EMPTY slot.
    const derived = within(list).getByText(FLOW_TITLE).closest('[role="listitem"]')! as HTMLElement;
    expect(within(derived).getByText(FLOWS[0].goal)).toBeInTheDocument();
    expect(within(derived).queryByText(/No longer derived/)).not.toBeInTheDocument();
  });

  /**
   * The MARKER, not the explanation (round-5): a sentence reads as description,
   * so the row wears a chip a scanning eye catches — beside the status, in the
   * same chip row, and never in a status colour, because "not in specs" says
   * nothing about pass/fail.
   */
  it('marks a flow the specs no longer derive with a neutral chip beside its status', () => {
    renderPanel({ flows: [...FLOWS, UNDERIVED_FLOW] });
    const list = screen.getByRole('list', { name: 'Flow inventory' });
    const row = within(list).getByText(UNDERIVED_ID).closest('[role="listitem"]')! as HTMLElement;

    const chip = within(row).getByText('Not in specs');
    const statusChip = within(row).getByText('Passing');
    expect(chip.parentElement).toBe(statusChip.parentElement);
    expect(chip.className).not.toMatch(/emerald|red|amber|sky|zinc/);
    // It is a marker, not a fifth status word — the row still says exactly one.
    expect(wordsIn(row)).toEqual(['Passing']);
    // …and the sentence it explains is still there, untouched.
    expect(
      within(row).getByText('No longer derived from your specs — kept because its test still runs.'),
    ).toBeInTheDocument();
  });

  it('marks nothing else — a flow the specs DO derive has no chip', () => {
    renderPanel({ flows: [...FLOWS, UNDERIVED_FLOW] });
    const list = screen.getByRole('list', { name: 'Flow inventory' });
    expect(within(list).getAllByText('Not in specs')).toHaveLength(1);
    for (const flow of FLOWS) {
      const row = within(list).getByText(flow.title).closest('[role="listitem"]')! as HTMLElement;
      expect(within(row).queryByText('Not in specs'), flow.flowId).not.toBeInTheDocument();
    }
  });

  /** The four plain words a row may show — exactly one of them, every time. */
  const STATUS_WORDS = ['Failing', 'Needs setup', 'Blocked', 'Not generated', 'Passing'];
  const wordsIn = (row: HTMLElement) => STATUS_WORDS.filter((w) => within(row).queryAllByText(w).length > 0);

  it('gives every row exactly one status word', () => {
    renderPanel({ flows: [...FLOWS, BIRTH_FAILED_FLOW, ERROR_ONLY_FLOW, LONG_BLOCKED_FLOW] });
    const list = screen.getByRole('list', { name: 'Flow inventory' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(FLOWS.length + 3);
    for (const row of rows) expect(wordsIn(row)).toHaveLength(1);
  });

  it('THE failing-vs-blocked pair: a committed failing test is Failing, an authoring error is NOT', () => {
    // The whole point of the vocabulary: Failing means a test RAN and failed.
    // Authoring never ran anything, so an error-only flow reads Not generated.
    renderPanel({ flows: [BIRTH_FAILED_FLOW, ERROR_ONLY_FLOW] });
    const list = screen.getByRole('list', { name: 'Flow inventory' });
    const birth = within(list).getByText(BIRTH_FAILED_FLOW.title).closest('[role="listitem"]')!;
    const errored = within(list).getByText(ERROR_ONLY_FLOW.title).closest('[role="listitem"]')!;
    expect(wordsIn(birth as HTMLElement)).toEqual(['Failing']);
    expect(wordsIn(errored as HTMLElement)).toEqual(['Not generated']);
    // The error count never leaks into the row as a number to decode.
    expect(within(list).queryByText(/2 errors/)).not.toBeInTheDocument();
  });

  it('maps EVERY coverage status to a status word — no state can render blank', () => {
    for (const status of GUARD_COVERAGE_STATUS_PRECEDENCE) {
      for (const bucket of ['guarded', 'partial', 'blocked', 'ungenerated'] as GuardFlowBucket[]) {
        const { unmount } = renderPanel({
          flows: [{ ...ERROR_ONLY_FLOW, errors: 0, status, bucket }],
        });
        const row = within(screen.getByRole('list', { name: 'Flow inventory' })).getAllByRole('listitem')[0];
        expect(wordsIn(row), `${status} / ${bucket}`).toHaveLength(1);
        unmount();
      }
    }
  });

  it('refuses to guess at a status the plain table never learned', () => {
    expect(() => guardPlainStatus('teleported' as GuardSectionCoverageStatus)).toThrow(/no plain status/);
  });

  it('shows the status word ONLY — the need and its reason are detail copy', () => {
    renderPanel({ flows: [...FLOWS, LONG_BLOCKED_FLOW] });
    const list = screen.getByRole('list', { name: 'Flow inventory' });
    const blocked = within(list).getByText(LONG_BLOCKED_FLOW.title).closest('[role="listitem"]')!;
    expect(wordsIn(blocked as HTMLElement)).toEqual(['Blocked']);
    expect(within(list).queryByText(new RegExp('blocked on llm-provider'))).not.toBeInTheDocument();
    expect(within(list).queryByText(/needs an LLM provider/)).not.toBeInTheDocument();
    expect(within(list).queryByText(/needs API recipe/)).not.toBeInTheDocument();
    expect(within(list).queryByText(/no code path mapped/)).not.toBeInTheDocument();
    expect(within(list).queryByText(/awaiting tui driver/)).not.toBeInTheDocument();
    // The filter says the SAME word the chip says — one state, one word.
    expect(
      within(screen.getByLabelText('Filter by status')).getByRole('option', { name: /^Blocked \(\d+\)$/ }),
    ).toBeInTheDocument();
  });

  it('filters by plain status and by search', async () => {
    const user = userEvent.setup();
    renderPanel();
    const filter = screen.getByLabelText('Filter by status');
    expect(within(filter).getByRole('option', { name: 'Failing (1)' })).toBeInTheDocument();
    expect(within(filter).getByRole('option', { name: 'Blocked (2)' })).toBeInTheDocument();
    expect(within(filter).getByRole('option', { name: 'Not generated (0)' })).toBeInTheDocument();
    expect(within(filter).getByRole('option', { name: 'Passing (1)' })).toBeInTheDocument();

    await user.selectOptions(filter, 'blocked');
    expect(screen.getByText('A user exports the task list')).toBeInTheDocument();
    expect(screen.queryByText(FLOW_TITLE)).not.toBeInTheDocument();

    await user.selectOptions(filter, 'failing');
    expect(screen.getByText(FLOW_TITLE)).toBeInTheDocument();
    expect(screen.queryByText('A user exports the task list')).not.toBeInTheDocument();

    await user.selectOptions(filter, 'all');
    await user.type(screen.getByLabelText('Search flows'), 'exports');
    expect(screen.getByText('A user exports the task list')).toBeInTheDocument();
    expect(screen.queryByText(FLOW_TITLE)).not.toBeInTheDocument();
  });

  it('previews a flow on single click and pins it on double click', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    renderPanel({ onOpen });
    await user.click(screen.getByText(FLOW_TITLE));
    expect(onOpen).toHaveBeenCalledWith(`flow:${FLOW_ID}`, false);
    await user.dblClick(screen.getByText(FLOW_TITLE));
    expect(onOpen).toHaveBeenCalledWith(`flow:${FLOW_ID}`, true);
  });

  it('carries no recipe / last-generate footer — that story lives in the overview', () => {
    renderPanel();
    expect(screen.queryByText(/Recipe ·/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Last generate/)).not.toBeInTheDocument();
  });

  it('scrolls the selected row into view when the selection arrives with the view', () => {
    const scrolled: Element[] = [];
    const spy = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(function (this: Element) {
        scrolled.push(this);
      });
    renderPanel({ activeId: `flow:${FLOWS[1].flowId}` });
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].textContent).toContain(FLOWS[1].title);
    spy.mockRestore();
  });
});

// --- The flow detail: one row per surface ----------------------------------

describe('GuardFlowDetail — a test, or one plain sentence saying why not', () => {
  const renderDetail = (props: Partial<Parameters<typeof GuardFlowDetail>[0]> = {}) =>
    render(
      <GuardFlowDetail
        detail={DETAIL}
        onOpenSpec={() => {}}
        onOpenTest={() => {}}
        onOpenInterface={() => {}}
        {...props}
      />,
    );

  it('paints each milestone: settled and section-drifted', () => {
    renderDetail();
    const graph = screen.getByRole('list', { name: 'Milestones' });
    expect(within(graph).getByLabelText(/Milestone 1: .* — settled/)).toBeInTheDocument();
    expect(within(graph).getByLabelText(/Milestone 2: .* — section drifted/)).toBeInTheDocument();
    // Colour is never the only signal — the legend names every paint on screen.
    expect(screen.getByText('settled')).toBeInTheDocument();
  });

  it('keeps the strip compact — claims are SENTENCES, and they live in the list', async () => {
    const user = userEvent.setup();
    const onOpenSpec = vi.fn();
    renderDetail({ onOpenSpec });
    const strip = screen.getByRole('list', { name: 'Milestones' });
    const claims = DETAIL.milestones.map((m) => m.claimTitle);

    // The strip carries NUMBERS, never sentences — a claim can't fit under a dot.
    for (const claim of claims) {
      expect(within(strip).queryByText(claim)).not.toBeInTheDocument();
    }
    expect(within(strip).getAllByRole('listitem')).toHaveLength(DETAIL.milestones.length);
    expect(within(strip).getByText('1')).toBeInTheDocument();
    // …and the claim is one hover away, on the node itself. The popover is
    // PORTALED (it can never be clipped), so it lives in the body, not the strip.
    expect(within(strip).queryByRole('tooltip')).toBeNull();
    expect(screen.getAllByRole('tooltip')[0]).toHaveTextContent(claims[0]);

    // The LIST beneath it is where the sentences read: glyph · number · claim ·
    // the section it binds to, as a jump.
    const list = screen.getByRole('list', { name: 'Milestones list' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(DETAIL.milestones.length);
    for (const [i, claim] of claims.entries()) {
      expect(within(rows[i]).getByText(claim)).toBeInTheDocument();
      expect(within(rows[i]).getByText(`§ ${DETAIL.milestones[i].headingText}`)).toBeInTheDocument();
    }
    // The paint glyph rides along, so the row says how that milestone went.
    expect(within(rows[1]).getByTitle('section drifted')).toBeInTheDocument();

    await user.click(within(rows[2]).getByText(`§ ${DETAIL.milestones[2].headingText}`));
    expect(onOpenSpec).toHaveBeenCalledWith(DOC, DETAIL.milestones[2].anchor);
  });

  it('jumps from a milestone to its spec section in Coverage', async () => {
    const user = userEvent.setup();
    const onOpenSpec = vi.fn();
    renderDetail({ onOpenSpec });
    await user.click(screen.getByLabelText(/Milestone 3: /));
    expect(onOpenSpec).toHaveBeenCalledWith(DOC, 'tasks/completing-tasks');
  });

  it('renders ONE row per surface: the test with its status, or why there is none', () => {
    renderDetail();
    const tests = screen.getByRole('list', { name: 'Tests' });
    const rows = within(tests).getAllByRole('listitem');
    expect(rows).toHaveLength(DETAIL.surfaces.length);

    // The cli surface HAS a test: surface, status word, and the test's title.
    expect(within(rows[0]).getByText('CLI test')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Failing')).toBeInTheDocument();
    expect(within(rows[0]).getByText(DETAIL.surfaces[0].title!)).toBeInTheDocument();

    // The web surface has NONE: the surface's own name, the SAME status word the
    // list shows, and the why as its own sentence — never dressed as a test.
    expect(within(rows[1]).getByText('Web')).toBeInTheDocument();
    expect(within(rows[1]).queryByText('Web test')).not.toBeInTheDocument();
    expect(within(rows[1]).getByText('Blocked')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Awaiting web driver.')).toBeInTheDocument();
    // The generator's raw reason never reaches the row.
    expect(within(tests).queryByText(/the board is browser-only/)).not.toBeInTheDocument();
  });

  /**
   * THE anti-drift lock. Words come from ONE module; `guard-status.ts` holds
   * colour and reads its label/hint from there. If anyone re-introduces a second
   * label table, these two resolve differently and this fails.
   */
  it('resolves every status to the SAME label in both former label sources', () => {
    for (const status of GUARD_COVERAGE_STATUS_PRECEDENCE) {
      expect(guardStatusMeta(status).label, status).toBe(guardStatusLabel(status));
      expect(guardStatusMeta(status).hint, status).toBe(guardStatusHint(status));
    }
    // The state the review caught: `blocked-on` IS the plain word, everywhere.
    expect(guardStatusLabel('blocked-on')).toBe(GUARD_FLOW_STATUS_WORD.blocked);
    expect(guardStatusWord('blocked-on')).toBe('Blocked');
  });

  it('says the SAME word in the list chip and the detail header', () => {
    const { unmount } = render(<FlowsPanelHarness flows={[CONFLICTS_FLOW]} />);
    const row = within(screen.getByRole('list', { name: 'Flow inventory' })).getAllByRole('listitem')[0];
    expect(within(row as HTMLElement).getByText('Blocked')).toBeInTheDocument();
    expect(within(row as HTMLElement).queryByText('Needs setup')).not.toBeInTheDocument();
    unmount();

    renderDetail({ detail: CONFLICTS_DETAIL });
    // The header wears the same word; "Needs setup" exists nowhere on the page.
    expect(screen.getAllByText('Blocked').length).toBeGreaterThan(0);
    expect(screen.queryByText(/Needs setup/i)).not.toBeInTheDocument();
  });

  it('a why-no-test row is NOT a test row: muted, unclickable, one plain sentence', async () => {
    const user = userEvent.setup();
    const onOpenTest = vi.fn();
    renderDetail({ detail: CONFLICTS_DETAIL, onOpenTest });
    const tests = screen.getByRole('list', { name: 'Tests' });
    const rows = within(tests).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    const row = rows[0];

    // The surface's own name — never "CLI test", which is what a TEST row says.
    expect(within(row).getByText('CLI')).toBeInTheDocument();
    expect(within(row).queryByText('CLI test')).not.toBeInTheDocument();
    // The status word, then the WHY as its own sentence — needs joined with "and".
    expect(within(row).getByText('Blocked')).toBeInTheDocument();
    expect(within(row).getByText('Needs credentials and network access.')).toBeInTheDocument();
    // Nothing about it invites a click: not a button, no hover affordance.
    expect(row.tagName).not.toBe('BUTTON');
    expect(row.querySelector('button')).toBeNull();
    expect(row.className).not.toMatch(/hover:|cursor-pointer/);
    await user.click(within(row).getByText('Needs credentials and network access.'));
    expect(onOpenTest).not.toHaveBeenCalled();
  });

  it('every row WITH a test navigates — the only clickable rows are real tests', async () => {
    const user = userEvent.setup();
    for (const detail of [DETAIL, BIRTH_FAILED_DETAIL]) {
      const onOpenTest = vi.fn();
      const { unmount } = render(
        <GuardFlowDetail
          detail={detail}
          onOpenSpec={() => {}}
          onOpenTest={onOpenTest}
          onOpenInterface={() => {}}
        />,
      );
      const tests = screen.getByRole('list', { name: 'Tests' });
      for (const row of within(tests).getAllByRole('listitem')) {
        const surface = detail.surfaces.find((s) => within(row).queryByText(s.title ?? '\u0000'));
        if (!surface?.scenarioId) continue;
        await user.click(row);
        expect(onOpenTest).toHaveBeenCalledWith(surface.scenarioId);
      }
      expect(onOpenTest).toHaveBeenCalled();
      unmount();
    }
  });

  it('renders its interfaces ONE PER LINE, the Interfaces pane row idiom', () => {
    renderDetail();
    const interfaces = screen.getByText('Interfaces').parentElement!;
    const list = interfaces.querySelector('div.flex.flex-col')!;
    expect(list).not.toBeNull();
    expect(list.className).toContain('flex-col');
    expect(list.querySelectorAll('button')).toHaveLength(DETAIL.interfaceIds.length);
  });

  it('has NO gaps block, NO findings block and NO authoring-errors block', () => {
    renderDetail({
      detail: {
        ...DETAIL,
        errors: [{ doc: DOC, anchor: 'tasks/creating-tasks', message: 'authoring blew up' }],
      },
    });
    expect(screen.queryByText('Gaps')).not.toBeInTheDocument();
    expect(screen.queryByText(/^Findings$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Authoring errors/)).not.toBeInTheDocument();
    expect(screen.queryByText(/authoring blew up/)).not.toBeInTheDocument();
  });

  it('says a flow whose authoring never finished will retry — never "Failing"', () => {
    renderDetail({ detail: ERROR_ONLY_DETAIL });
    const tests = screen.getByRole('list', { name: 'Tests' });
    expect(within(tests).getByText(/Couldn’t create the test — will retry next generate/)).toBeInTheDocument();
    expect(within(tests).queryByText('Failing')).not.toBeInTheDocument();
  });

  /**
   * WHY authoring could not write a test is information no sentence carries, so the
   * run's own words ride inside the row — deduped by message shape with an attempt
   * count, never N near-identical rows.
   */
  it('lists an authoring-error row’s reasons ONCE each, with how many attempts hit them', () => {
    renderDetail({
      detail: {
        ...ERROR_ONLY_DETAIL,
        errors: [
          { doc: 'README.md', anchor: 'analyze', kind: 'authoring', surface: 'cli', message: 'authoring (cli) call failed: claude timed out after 600000ms' },
          { doc: 'README.md', anchor: 'analyze', kind: 'authoring', surface: 'cli', message: 'authoring (cli) call failed: claude timed out after 600000ms' },
          { doc: 'README.md', anchor: 'analyze', kind: 'authoring', surface: 'cli', message: 'authoring (cli) output invalid after re-ask: bad shape' },
          // Another surface's failure never leaks into this row.
          { doc: 'README.md', anchor: 'analyze', kind: 'authoring', surface: 'api', message: 'authoring (api) call failed: transport exploded' },
        ],
      },
    });
    const tests = screen.getByRole('list', { name: 'Tests' });

    // The two timeouts fold into ONE reason, counted twice; the invalid output is
    // its own reason, counted once.
    expect(within(tests).getAllByText(/timed out after 600000ms/)).toHaveLength(1);
    expect(within(tests).getByText('2 attempts')).toBeInTheDocument();
    expect(within(tests).getByText(/output invalid after re-ask/)).toBeInTheDocument();
    expect(within(tests).getByText('1 attempt')).toBeInTheDocument();
    expect(within(tests).queryByText(/transport exploded/)).not.toBeInTheDocument();
  });

  it('shows no reasons on a row that is not an authoring error', () => {
    renderDetail({ detail: NOT_ATTEMPTED_DETAIL });
    const tests = screen.getByRole('list', { name: 'Tests' });
    expect(within(tests).queryByText(/\d+ attempt/)).not.toBeInTheDocument();
  });

  /**
   * The opposite promise, for the opposite fact: the run was REFUSED — declined from
   * configuration before anything was built or executed. "Will retry next generate"
   * is false there (every re-run is declined identically), and it is exactly what the
   * flow page said for a run that produced zero tests across the whole corpus.
   */
  it('says what BLOCKED a flow when the run was refused — never the retry sentence', () => {
    const message = 'external service hit-pay is only partly configured: no key was resolved.';
    renderDetail({
      detail: {
        ...ERROR_ONLY_DETAIL,
        errors: [{ doc: '(guard run)', anchor: '(refused)', kind: 'refusal', message }],
      },
    });
    const tests = screen.getByRole('list', { name: 'Tests' });
    expect(within(tests).getByText(/Nothing could be tested/)).toBeInTheDocument();
    expect(within(tests).getByText(/hit-pay is only partly configured/)).toBeInTheDocument();
    expect(within(tests).queryByText(/will retry next generate/)).not.toBeInTheDocument();
  });

  /**
   * A flow nothing has been attempted for yet — no test, no gap, no error. It used
   * to fall through to a bare line of prose ("Nothing tests this flow yet."), which
   * is neither a status nor a next step; it now reads as the same row every other
   * surface gets.
   */
  it('says a flow nothing was attempted for is not generated — never a bare line', () => {
    renderDetail({ detail: NOT_ATTEMPTED_DETAIL });
    const tests = screen.getByRole('list', { name: 'Tests' });
    expect(within(tests).getByText('Not generated')).toBeInTheDocument();
    expect(
      within(tests).getByText(/No test yet — will be attempted on the next generate/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Nothing tests this flow yet/)).not.toBeInTheDocument();
    // The retry sentence belongs to an authoring that RAN — nothing ran here.
    expect(within(tests).queryByText(/will retry next generate/)).not.toBeInTheDocument();
  });

  it('marks a test that failed its birth execution, and keeps it clickable', async () => {
    const user = userEvent.setup();
    const onOpenTest = vi.fn();
    renderDetail({ detail: BIRTH_FAILED_DETAIL, onOpenTest });
    const tests = screen.getByRole('list', { name: 'Tests' });
    expect(within(tests).getByText('Failing (birth)')).toBeInTheDocument();
    await user.click(within(tests).getByText(BIRTH_FAILED_DETAIL.surfaces[0].title!));
    expect(onOpenTest).toHaveBeenCalledWith(BIRTH_FAILED_ID);
  });

  /**
   * The hollow-page fix: a flow the specs no longer derive has no goal and no
   * milestones BY NATURE. One sentence takes the goal's place and says why; its
   * test still reads and clicks like any other.
   */
  it('says why a flow the specs no longer derive is empty — where the goal would be', async () => {
    const user = userEvent.setup();
    const onOpenTest = vi.fn();
    renderDetail({ detail: UNDERIVED_DETAIL, onOpenTest });

    expect(
      screen.getByText('No longer derived from your specs — kept because its test still runs.'),
    ).toBeInTheDocument();
    // It replaces the goal, so it sits in the header, above the Tests block.
    expect(screen.queryByText('Milestones')).not.toBeInTheDocument();
    const tests = screen.getByRole('list', { name: 'Tests' });
    expect(within(tests).getByText('Passing')).toBeInTheDocument();
    await user.click(within(tests).getByText('Purged tasks leave the list'));
    expect(onOpenTest).toHaveBeenCalledWith(UNDERIVED_TEST_ID);
  });

  /** The detail carries BOTH halves: the chip that marks it, the sentence that
   *  explains it. Neither replaces the other (round-5). */
  it('marks the header of a flow the specs no longer derive, and keeps the sentence', () => {
    renderDetail({ detail: UNDERIVED_DETAIL });
    const chip = screen.getByText('Not in specs');
    // The header's chip row — the same one the status chip sits in.
    expect(within(chip.parentElement!).getByText('Passing')).toBeInTheDocument();
    expect(chip.className).not.toMatch(/emerald|red|amber|sky|zinc/);
    expect(
      screen.getByText('No longer derived from your specs — kept because its test still runs.'),
    ).toBeInTheDocument();
  });

  it('never explains a flow the specs DO derive', () => {
    renderDetail();
    expect(screen.getByText(DETAIL.goal)).toBeInTheDocument();
    expect(screen.queryByText(/No longer derived from your specs/)).not.toBeInTheDocument();
    expect(screen.queryByText('Not in specs')).not.toBeInTheDocument();
  });

  it('opens a test on the Tests tab — a test has exactly one home', async () => {
    const user = userEvent.setup();
    const onOpenTest = vi.fn();
    renderDetail({ onOpenTest });
    await user.click(screen.getByText(DETAIL.surfaces[0].title!));
    expect(onOpenTest).toHaveBeenCalledWith(SCENARIO_ID);
  });

  it('renders the milestone chain without a scroll container of its own', () => {
    render(
      <GuardFlowDetail
        detail={{
          ...DETAIL,
          milestones: Array.from({ length: 12 }, (_, i) => ({
            ...DETAIL.milestones[0],
            order: i + 1,
            claimTitle: `Milestone claim ${i + 1}`,
          })),
        }}
        onOpenSpec={() => {}}
        onOpenTest={() => {}}
        onOpenInterface={() => {}}
      />,
    );
    const graph = screen.getByRole('list', { name: 'Milestones' });
    expect(within(graph).getAllByRole('listitem')).toHaveLength(12);
    // The chain itself clips nothing — the pane it sits in owns the scrolling.
    const graphRoot = graph.parentElement!;
    for (let el: HTMLElement | null = graph; el; el = el.parentElement) {
      expect(el.className).not.toMatch(/overflow-(auto|hidden|scroll|x-|y-)/);
      expect(el.className).not.toMatch(/(^|\s)(max-)?h-\d/);
      if (el === graphRoot) break;
    }
    // …and a node's hover is portaled out of the tree entirely, so no ancestor
    // anywhere above it can cut it off.
    expect(within(graph).queryByRole('tooltip')).toBeNull();
    const popover = screen.getAllByRole('tooltip')[0];
    expect(popover.parentElement).toBe(document.body);
  });
});

// --- The pane: tabs and deep links -----------------------------------------

function FlowsHarness({
  onOpenTest = () => {},
  flows = FLOWS,
}: {
  onOpenTest?: (id: string) => void;
  flows?: GuardFlowListItem[];
}) {
  const tabs = useGuardFlowTabs('r');
  const loc = useLocation();
  // The page owns the filter, so the overview's chips and the panel's dropdown
  // are two controls over ONE narrowing — exactly the wiring under test.
  const [filter, setFilter] = useState<GuardFlowFilter>('all');
  return (
    <div>
      <span data-testid="search">{loc.search}</span>
      <div data-testid="panel">
        <GuardFlowsPanel
          flows={flows}
          loading={false}
          error={null}
          activeId={tabs.activeId}
          filter={filter}
          onFilter={setFilter}
          onOpen={tabs.open}
        />
      </div>
      <GuardFlowsPane
        repoId="r"
        view={{ ...VIEW, flows }}
        loading={false}
        error={null}
        report={REPORT}
        tabs={tabs}
        filter={filter}
        onFilter={setFilter}
        onOpenSpec={() => {}}
        onOpenTest={onOpenTest}
        onOpenInterface={() => {}}
      />
    </div>
  );
}

const renderPane = (url = '/repos/r?tab=guardflows', onOpenTest?: (id: string) => void) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <FlowsHarness {...(onOpenTest ? { onOpenTest } : {})} />
    </MemoryRouter>,
  );

const search = () => screen.getByTestId('search').textContent ?? '';

describe('GuardFlowsPane — tabs and deep links', () => {
  it('opening a flow from the panel mirrors ?gflow and renders its detail', async () => {
    const user = userEvent.setup();
    renderPane();
    await user.click(within(screen.getByTestId('panel')).getByText(FLOW_TITLE));
    expect(search()).toContain(`gflow=${FLOW_ID}`);
    expect(await screen.findByRole('list', { name: 'Milestones' })).toBeInTheDocument();
  });

  it('a ?gflow deep link lands on the flow detail', async () => {
    renderPane(`/repos/r?tab=guardflows&gflow=${FLOW_ID}`);
    expect(await screen.findByRole('list', { name: 'Milestones' })).toBeInTheDocument();
    expect(screen.getAllByText(DETAIL.goal)).toHaveLength(2);
  });

  it('a test row routes OUT to the Tests tab instead of opening a tab here', async () => {
    const user = userEvent.setup();
    const onOpenTest = vi.fn();
    renderPane(`/repos/r?tab=guardflows&gflow=${FLOW_ID}`, onOpenTest);
    await screen.findByRole('list', { name: 'Tests' });
    await user.click(screen.getByText(DETAIL.surfaces[0].title!));
    expect(onOpenTest).toHaveBeenCalledWith(SCENARIO_ID);
    // No second home: the Flows tab never grows a test tab of its own.
    expect(search()).not.toContain('gscn=');
    expect(search()).not.toContain('gtest=');
  });

  it('shows the generate overview when no tab is open', () => {
    renderPane();
    const overview = screen.getByRole('region', { name: 'Generate overview' });
    // The corpus in the LIST's words, then ONE last-generate line, then the one
    // retry line. The old stats (tests written, calls, birth-passed) are gone —
    // none of them named anything visible on this tab.
    expect(within(overview).getByRole('group', { name: 'Flow filters' })).toBeInTheDocument();
    expect(within(overview).getByText(/6 flows changed · \$3\.50/)).toBeInTheDocument();
    expect(within(overview).getByText(/1 flow will retry next generate\./)).toBeInTheDocument();
    expect(within(overview).queryByText('tests written')).not.toBeInTheDocument();
    expect(within(overview).queryByText('calls')).not.toBeInTheDocument();
  });
});

// --- The FLOW dismissal ----------------------------------------------------
//
// The flow is the ONE manual dismissal unit. The round trip runs through the
// real `useGuardDecisions` hook against stubbed routes, so the panel marker, the
// detail ruling and the two writes are proven as one wiring rather than three
// mocks agreeing with each other.

function DismissHarness() {
  const tabs = useGuardFlowTabs('r');
  const [filter, setFilter] = useState<GuardFlowFilter>('all');
  const decisions = useGuardDecisions('r', true);
  return (
    <div>
      <div data-testid="panel">
        <GuardFlowsPanel
          flows={FLOWS}
          loading={false}
          error={null}
          activeId={tabs.activeId}
          filter={filter}
          onFilter={setFilter}
          onOpen={tabs.open}
          dismissedFlowIds={decisions.dismissedFlowIds}
        />
      </div>
      <GuardFlowsPane
        repoId="r"
        view={VIEW}
        loading={false}
        error={null}
        report={REPORT}
        tabs={tabs}
        filter={filter}
        onFilter={setFilter}
        decisions={decisions}
        onOpenSpec={() => {}}
        onOpenTest={() => {}}
        onOpenInterface={() => {}}
      />
    </div>
  );
}

describe('flow dismissal — the one manual unit', () => {
  /** The decisions file the stubbed routes read and write. */
  let dismissedFlows: { flowId: string; title: string; note?: string; dismissedAt: string }[];
  let calls: { url: string; body: unknown }[];

  beforeEach(() => {
    dismissedFlows = [];
    calls = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        const body = init?.body ? JSON.parse(String(init.body)) : undefined;
        if (u.includes('/guard/flows/dismiss')) {
          calls.push({ url: u, body });
          dismissedFlows = [
            ...dismissedFlows.filter((f) => f.flowId !== body.flowId),
            { ...body, dismissedAt: '2026-07-31T00:00:00.000Z' },
          ];
          return json({ version: 1, dismissedClaims: [], dismissedFlows });
        }
        if (u.includes('/guard/flows/undismiss')) {
          calls.push({ url: u, body });
          dismissedFlows = dismissedFlows.filter((f) => f.flowId !== body.flowId);
          return json({ version: 1, dismissedClaims: [], dismissedFlows });
        }
        if (u.includes('/guard/decisions')) return json({ version: 1, dismissedClaims: [], dismissedFlows });
        if (u.includes('/guard/flows/')) return json(DETAIL);
        return json({});
      }),
    );
  });

  const renderHarness = () =>
    render(
      <MemoryRouter initialEntries={[`/repos/r?tab=guardflows&gflow=${FLOW_ID}`]}>
        <DismissHarness />
      </MemoryRouter>,
    );

  it('rules the flow out from its detail, and the list row says so without a re-generate', async () => {
    const user = userEvent.setup();
    renderHarness();
    // Nothing is dismissed yet: no marker on the row, and the ruling is offered.
    const panel = screen.getByTestId('panel');
    expect(within(panel).queryByText('Dismissed')).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Don’t test this flow/ }));

    // The detail now explains the consequence and offers the undo…
    expect(await screen.findByRole('button', { name: 'Un-dismiss' })).toBeInTheDocument();
    expect(screen.getByText(/drops this flow and deletes its tests/)).toBeInTheDocument();
    // …and the LIST row wears the marker immediately — the ruling is a decision,
    // not a run, so nothing waits on the engine.
    expect(within(panel).getByText('Dismissed')).toBeInTheDocument();

    // The write carried the flow's identity AND its display copy.
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/guard/flows/dismiss');
    expect(calls[0].body).toEqual({ flowId: FLOW_ID, title: DETAIL.title });
  });

  it('un-dismisses back to the offered ruling', async () => {
    const user = userEvent.setup();
    dismissedFlows = [
      { flowId: FLOW_ID, title: DETAIL.title, note: 'not a user path', dismissedAt: '2026-07-30T00:00:00.000Z' },
    ];
    renderHarness();
    // The recorded rationale rides with the state, so the undo is an informed one.
    expect(await screen.findByText('not a user path')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Un-dismiss' }));

    expect(await screen.findByRole('button', { name: /Don’t test this flow/ })).toBeInTheDocument();
    expect(within(screen.getByTestId('panel')).queryByText('Dismissed')).not.toBeInTheDocument();
    expect(calls[0].body).toEqual({ flowId: FLOW_ID });
  });

  // The dismissal is a decision about whether to TEST the flow, never a verdict
  // on whether it passes — so the status chip beside the marker is untouched.
  it('never replaces the flow status — the marker sits beside it', async () => {
    renderHarness();
    await screen.findByRole('button', { name: /Don’t test this flow/ });
    const row = within(screen.getByTestId('panel')).getAllByRole('listitem')[0];
    expect(row.textContent).toContain(GUARD_FLOW_STATUS_WORD.failing);
  });

  // Without the decisions state (guard reads gated, an unresolved PR scope) the
  // ruling is not merely disabled — it is absent.
  it('offers no ruling at all when the pane has no decisions state', async () => {
    render(
      <MemoryRouter initialEntries={[`/repos/r?tab=guardflows&gflow=${FLOW_ID}`]}>
        <FlowsHarness />
      </MemoryRouter>,
    );
    await screen.findByRole('list', { name: 'Tests' });
    expect(screen.queryByRole('button', { name: /Don’t test this flow/ })).not.toBeInTheDocument();
  });
});

// --- The overview IS the list's filter dashboard ----------------------------

/**
 * A flow blocked on a third party the user CAN provide — the same `blocked-on`
 * gap kind, promoted by the read model to `needs-setup` because the externals
 * view knows `open-meteo` and it is unprovided.
 */
const NEEDS_SETUP_FLOW: GuardFlowListItem = {
  flowId: 'fetch-the-forecast-for-a-place',
  title: 'A visitor fetches the forecast for a place',
  goal: 'Answer with the upstream forecast',
  status: 'needs-setup',
  bucket: 'blocked',
  epic: false,
  composedOf: [],
  manual: false,
  milestoneCount: 2,
  sectionCount: 1,
  docs: ['docs/SPEC.md'],
  surfaces: [
    {
      surface: 'api',
      status: 'needs-setup',
      gap: {
        kind: 'blocked-on',
        reason: 'blocked on open-meteo: the forecast comes from the upstream service',
        label: 'blocked-on',
        needsSetup: { services: ['open-meteo'], provided: [] },
      },
    },
  ],
  findings: 0,
  toolDefects: 0,
  errors: 0,
  interfaceDrifted: false,
};

/** A corpus with every state on it — failing, needs-setup, blocked, not
 *  generated, passing, and one flow the specs no longer derive. */
const MIXED_FLOWS: GuardFlowListItem[] = [
  ...FLOWS,
  BIRTH_FAILED_FLOW,
  ERROR_ONLY_FLOW,
  NEEDS_SETUP_FLOW,
  UNDERIVED_FLOW,
];

describe('GuardScenariosOverview — the Flows filter dashboard', () => {
  const renderMixed = () =>
    render(
      <MemoryRouter initialEntries={['/repos/r?tab=guardflows']}>
        <FlowsHarness flows={MIXED_FLOWS} />
      </MemoryRouter>,
    );

  const chips = () =>
    within(screen.getByRole('group', { name: 'Flow filters' })).getAllByRole('button');
  const listRows = () =>
    within(within(screen.getByTestId('panel')).getByRole('list', { name: 'Flow inventory' })).queryAllByRole(
      'listitem',
    );

  it('counts the corpus in the list vocabulary, total first', () => {
    renderMixed();
    expect(chips().map((c) => c.textContent)).toEqual([
      '8flows',
      '2Failing',
      // The actionable slice of blocked, split out and ranked directly
      // below Failing — a providable third party is a to-do, not a wall.
      '1Needs setup',
      '2Blocked',
      '1Not generated',
      '2Passing',
      '1Not in specs',
    ]);
  });

  it('every chip count EQUALS the rows clicking it shows, and the dropdown follows', async () => {
    const user = userEvent.setup();
    renderMixed();
    const select = () => within(screen.getByTestId('panel')).getByLabelText('Filter by status') as HTMLSelectElement;

    const all = chips();
    expect(all).toHaveLength(GUARD_FLOW_FILTER_ORDER.length);
    for (const [i, chip] of all.entries()) {
      const count = Number(chip.textContent?.match(/^\d+/)?.[0]);
      await user.click(chip);
      expect(listRows(), chip.textContent ?? '').toHaveLength(count);
      expect(chip.getAttribute('aria-pressed')).toBe('true');
      // One narrowing, two controls: the panel's dropdown moved with the chip.
      expect(select().value, chip.textContent ?? '').toBe(GUARD_FLOW_FILTER_ORDER[i]);
    }
  });

  it('the total chip CLEARS the filter', async () => {
    const user = userEvent.setup();
    renderMixed();
    await user.click(chips()[1]); // Failing
    expect(listRows()).toHaveLength(2);
    await user.click(chips()[0]); // total
    expect(listRows()).toHaveLength(MIXED_FLOWS.length);
    expect((within(screen.getByTestId('panel')).getByLabelText('Filter by status') as HTMLSelectElement).value).toBe(
      'all',
    );
  });
});

// --- The Runs tab: a result is an INSTANCE of its flow ----------------------

const RUN_FLOW: GuardRunFlow = {
  flowId: FLOW_ID,
  title: FLOW_TITLE,
  goal: 'Create, list, complete and filter a task from the CLI',
  epic: false,
  milestones: DETAIL.milestones.map((m) => ({
    order: m.order,
    doc: m.doc,
    anchor: m.anchor,
    claimTitle: m.claimTitle,
  })),
};

const FAILED_RESULT: GuardScenarioResult = {
  id: SCENARIO_ID,
  title: 'Tasks are created, listed newest-first, completed and filterable',
  binds: { doc: DOC, section: 'tasks/creating-tasks', fingerprint: 'sha256:x' },
  outcome: 'fail',
  durationMs: 412,
  failure: { step: 3, expected: 'exit 0', actual: 'exit 1: unknown command `done`' },
  evidencePath: `.truecourse/guard/evidence/${RUN_ID}/${SCENARIO_ID}`,
  flowId: FLOW_ID,
  failedMilestone: 3,
  interfaceDrifted: true,
};

describe('GuardDriftDetail — the flow instance in execution paint', () => {
  const renderRun = (
    scenario: GuardScenarioResult,
    runFlow: GuardRunFlow | null = RUN_FLOW,
    onOpenTest?: (id: string) => void,
  ) =>
    render(
      <GuardDriftDetail
        repoId="r"
        scenario={scenario}
        runId={RUN_ID}
        runFlow={runFlow}
        onOpenSpec={() => {}}
        {...(onOpenTest ? { onOpenTest } : {})}
      />,
    );

  it('paints pass up to the failure, fail at the milestone, and a not-reached tail', async () => {
    renderRun(FAILED_RESULT);
    const graph = screen.getByRole('list', { name: 'Milestones' });
    expect(within(graph).getByLabelText(/Milestone 1: .* — pass/)).toBeInTheDocument();
    expect(within(graph).getByLabelText(/Milestone 2: .* — pass/)).toBeInTheDocument();
    expect(within(graph).getByLabelText(/Milestone 3: .* — fail/)).toBeInTheDocument();
    expect(within(graph).getByLabelText(/Milestone 4: .* — not reached/)).toBeInTheDocument();
    expect(screen.getByText(/Failed at step/)).toBeInTheDocument();
    // What it got reads in the failing step's own record, which starts open.
    expect(await screen.findByLabelText('actual value')).toHaveTextContent('exit 1: unknown command `done`');
    expect(screen.getByText(/Interface drift/)).toBeInTheDocument();
  });

  it('opens IN PLACE and offers ONE link out to the test itself', async () => {
    const user = userEvent.setup();
    const onOpenTest = vi.fn();
    renderRun(FAILED_RESULT, RUN_FLOW, onOpenTest);
    // The run's own record is what renders — the transcript and steps stay here.
    expect(screen.getByLabelText('test steps')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /open this test/ }));
    expect(onOpenTest).toHaveBeenCalledWith(SCENARIO_ID);
  });

  it('is the SAME screen as the Tests tab, marked as this run\u2019s record', async () => {
    renderRun(FAILED_RESULT, RUN_FLOW, () => {});
    // Same skeleton, different feed: the provenance line is the only tell.
    expect(screen.getByText(`As of run ${RUN_ID}`)).toBeInTheDocument();
    expect(screen.queryByText('Latest state')).not.toBeInTheDocument();
    expect(screen.getByText('Verdict')).toBeInTheDocument();
    expect(await screen.findByLabelText('test steps')).toBeInTheDocument();
    // The run-scoped chrome it adds: the flow instance in execution paint.
    expect(screen.getByRole('list', { name: 'Milestones' })).toBeInTheDocument();
  });

  it('claims nothing when the failure names no milestone (a plumbing failure)', () => {
    renderRun({ ...FAILED_RESULT, failedMilestone: undefined, interfaceDrifted: undefined });
    const graph = screen.getByRole('list', { name: 'Milestones' });
    expect(within(graph).getAllByLabelText(/— no milestone reached/)).toHaveLength(4);
    expect(within(graph).queryByLabelText(/— pass/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Interface drift/)).not.toBeInTheDocument();
  });

  it('marks a blocked precondition beside the failure, distinctly from drift', () => {
    renderRun({
      ...FAILED_RESULT,
      failedMilestone: undefined,
      interfaceDrifted: undefined,
      blockedPrecondition: true,
      failure: { step: 1, expected: '200', actual: '404' },
    });
    expect(screen.getByText(/Setup failed/)).toBeInTheDocument();
    expect(screen.queryByText(/Interface drift/)).not.toBeInTheDocument();
    // The outcome is untouched: the verdict still reads as a failure.
    expect(screen.getByText(/Failed at step/)).toBeInTheDocument();
  });

  it('says nothing about setup when the failing step realized a milestone', () => {
    renderRun(FAILED_RESULT);
    expect(screen.queryByText(/Setup failed/)).not.toBeInTheDocument();
  });

  it('paints every milestone green on a pass', () => {
    renderRun({ ...FAILED_RESULT, outcome: 'pass', failure: undefined, failedMilestone: undefined });
    const graph = screen.getByRole('list', { name: 'Milestones' });
    expect(within(graph).getAllByLabelText(/— pass/)).toHaveLength(4);
  });

  it('falls back to the plain claim story when the run joined no flow', () => {
    renderRun({ ...FAILED_RESULT, flowId: undefined }, null);
    expect(screen.queryByRole('list', { name: 'Milestones' })).not.toBeInTheDocument();
    expect(screen.getByText(/Failed at step/)).toBeInTheDocument();
  });
});
