/**
 * Guard CLAIMS-tab tests, on the governing model:
 *
 *   a claim is one testable statement a doc makes, and it is only worth reading
 *   if both of its traces are readable — UP to the section that states it, DOWN to
 *   the flows and scenario steps that prove it.
 *
 * Covers the LEFT PANEL (grouped by doc, then by the section within it, with the
 * doc's refused statements as a final quieter group, every row previewable), the
 * PANE (the totals overview when nothing is selected, the empty state before any
 * extraction), and the DETAIL (the claim sentence, what testing it needs, and both
 * traces as real jumps). Then the coverage view's half of the same story: a
 * section's gapped claims stay visible beside its flows however the section ranks.
 *
 * Plus the step-grouping fix the claim corpus made necessary: a step tagged with a
 * claim IDENTITY rather than a milestone POSITION is not preparation, so its group
 * must never head "Setup".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type {
  GuardClaimRow,
  GuardClaimsView,
  GuardScenarioStepView,
  GuardSectionCoverage,
} from '@truecourse/shared';
import { GuardClaimsPanel } from '@/components/guard/GuardClaimsPanel';
import { GuardClaimsPane } from '@/components/guard/GuardClaimsPane';
import { GuardSectionDetail } from '@/components/guard/GuardSectionDetail';
import { GuardTestView, groupStepsByMilestone, type GuardTestViewModel } from '@/components/guard/GuardTestView';
import { useGuardClaimTabs } from '@/hooks/useGuardClaimTabs';
import { guardTestStatusView } from '@/lib/guard-flow-status';
import { guardUntestableEntries } from '@/lib/guard-claims';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const DOC = 'docs/specs/tasks.md';
const OTHER_DOC = 'docs/specs/reminders.md';
const CREATE_ANCHOR = 'tasks/creating-tasks';
const LIST_ANCHOR = 'tasks/listing-tasks';
const REMIND_ANCHOR = 'reminders/scheduling';

const PROVEN_ID = 'tasks/creating-tasks#1';
const GAPPED_ID = 'tasks/listing-tasks#1';
const ORPHANED_ID = 'reminders/scheduling#1';

const FLOW_ID = 'task-lifecycle';
const FLOW_TITLE = 'A user creates a task and sees its id';
const SCENARIO_ID = 'task-lifecycle.cli.1';
const SCENARIO_TITLE = 'Adding a task prints the new id';

const PROVEN: GuardClaimRow = {
  id: PROVEN_ID,
  doc: DOC,
  anchor: CREATE_ANCHOR,
  title: 'Creating a task prints its id',
  claim: 'Running `tasks add` writes the new task and prints its id on stdout, exiting 0.',
  contentHash: 'sha256:41acbb01',
  verifyVia: 'the cli entrypoint',
  needs: ['cli', 'seeded tasks'],
  notes: 'Read out of the second paragraph, which states the id is printed and not merely stored.',
  headingText: 'Creating tasks',
  anchorLive: true,
  coverage: 'proven',
  dismissed: false,
  flows: [{ flowId: FLOW_ID, title: FLOW_TITLE, milestoneOrder: 1, note: 'the add step carries it' }],
  scenarios: [{ scenarioId: SCENARIO_ID, title: SCENARIO_TITLE, steps: [2, 3] }],
};

const GAPPED: GuardClaimRow = {
  id: GAPPED_ID,
  doc: DOC,
  anchor: LIST_ANCHOR,
  title: 'The list shows tasks newest-first',
  claim: '`tasks list` prints the tasks with the most recently added one first.',
  contentHash: 'sha256:9f2caa',
  needs: ['cli'],
  headingText: 'Listing tasks',
  anchorLive: true,
  coverage: 'gapped',
  gapReason: 'no cli journey lists tasks',
  dismissed: false,
  flows: [],
  scenarios: [],
};

/** The claim whose section the live doc no longer has — the orphaned anchor. */
const ORPHANED: GuardClaimRow = {
  id: ORPHANED_ID,
  doc: OTHER_DOC,
  anchor: REMIND_ANCHOR,
  title: 'A reminder can be scheduled for a task',
  claim: 'A task accepts a reminder time and the API answers 201 with the stored reminder.',
  contentHash: 'sha256:c0ffee',
  needs: ['api', 'credentials'],
  anchorLive: false,
  coverage: 'unplanned',
  dismissed: true,
  flows: [],
  scenarios: [],
};

const UNTESTABLE_TEXT = 'Tasks are the heart of the product.';

const VIEW: GuardClaimsView = {
  extracted: true,
  generatedAt: '2026-08-05T13:40:00.000Z',
  claims: [PROVEN, GAPPED, ORPHANED],
  untestable: [
    {
      doc: DOC,
      anchor: CREATE_ANCHOR,
      text: UNTESTABLE_TEXT,
      reason: 'a value statement — running the product can neither confirm nor deny it',
      headingText: 'Creating tasks',
      anchorLive: true,
    },
  ],
  totals: {
    claims: 3,
    proven: 1,
    planned: 0,
    gapped: 1,
    unplanned: 1,
    dismissed: 1,
    untestable: 1,
    orphanedAnchors: 1,
  },
};

const UNTESTABLE_ID = guardUntestableEntries(VIEW)[0].id;

const EMPTY_VIEW: GuardClaimsView = {
  extracted: false,
  generatedAt: null,
  claims: [],
  untestable: [],
  totals: {
    claims: 0,
    proven: 0,
    planned: 0,
    gapped: 0,
    unplanned: 0,
    dismissed: 0,
    untestable: 0,
    orphanedAnchors: 0,
  },
};

// --- The left panel --------------------------------------------------------

function renderPanel(view: GuardClaimsView = VIEW, activeId: string | null = null) {
  return render(
    <GuardClaimsPanel
      claims={view.claims}
      untestable={guardUntestableEntries(view)}
      loading={false}
      error={null}
      activeId={activeId}
      onOpen={() => {}}
    />,
  );
}

describe('GuardClaimsPanel — the claim corpus', () => {
  const list = () => screen.getByRole('list', { name: 'Claim corpus' });

  it('groups by DOC, then by the SECTION that states each claim', () => {
    renderPanel();
    // Both docs head their own group, each section under its live heading.
    expect(within(list()).getByText(DOC)).toBeInTheDocument();
    expect(within(list()).getByText(OTHER_DOC)).toBeInTheDocument();
    expect(within(list()).getByText('Creating tasks')).toBeInTheDocument();
    expect(within(list()).getByText('Listing tasks')).toBeInTheDocument();
    // A section whose anchor no longer resolves has no heading text — the group
    // falls back to the anchor rather than rendering a blank header.
    expect(within(list()).getByText(REMIND_ANCHOR)).toBeInTheDocument();
  });

  it('renders a row per claim — its title and what testing it needs', () => {
    renderPanel();
    const row = within(list()).getByText(PROVEN.title).closest('[role="listitem"]') as HTMLElement;
    expect(within(row).getByText('needs cli, seeded tasks')).toBeInTheDocument();
    // Every claim in the corpus is listed, plus the one refused statement.
    expect(within(list()).getAllByRole('listitem')).toHaveLength(VIEW.claims.length + 1);
  });

  it('closes each doc with its REFUSED statements, selectable like any other row', () => {
    renderPanel();
    expect(within(list()).getByText('Not claimed')).toBeInTheDocument();
    const row = within(list()).getByText(UNTESTABLE_TEXT).closest('[role="listitem"]') as HTMLElement;
    expect(row).toBeInTheDocument();
    // A refused statement wears its reason, never a coverage state.
    expect(within(row).getByText(/value statement/)).toBeInTheDocument();
  });

  it('the search narrows on id, title and claim text', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(screen.getByLabelText('Search claims'), 'newest-first');
    expect(within(list()).getByText(GAPPED.title)).toBeInTheDocument();
    expect(within(list()).queryByText(PROVEN.title)).not.toBeInTheDocument();
    // The doc that keeps nothing drops out entirely — no empty group headers.
    expect(within(list()).queryByText(OTHER_DOC)).not.toBeInTheDocument();
  });
});

// --- The pane: tabs, deep links, the detail ---------------------------------

function ClaimsHarness({
  view = VIEW,
  onOpenSpec = () => {},
  onOpenFlow = () => {},
  onOpenTest = () => {},
}: {
  view?: GuardClaimsView;
  onOpenSpec?: (doc: string, anchor: string) => void;
  onOpenFlow?: (flowId: string) => void;
  onOpenTest?: (scenarioId: string) => void;
}) {
  const tabs = useGuardClaimTabs('r');
  const loc = useLocation();
  const untestable = guardUntestableEntries(view);
  return (
    <div>
      <span data-testid="qs">{loc.search}</span>
      <div data-testid="panel">
        <GuardClaimsPanel
          claims={view.claims}
          untestable={untestable}
          loading={false}
          error={null}
          activeId={tabs.activeId}
          onOpen={tabs.open}
        />
      </div>
      <div data-testid="pane">
        <GuardClaimsPane
          view={view}
          untestable={untestable}
          loading={false}
          error={null}
          tabs={tabs}
          onOpenSpec={onOpenSpec}
          onOpenFlow={onOpenFlow}
          onOpenTest={onOpenTest}
        />
      </div>
    </div>
  );
}

const renderClaims = (url = '/repos/r?tab=guardclaims', props: Parameters<typeof ClaimsHarness>[0] = {}) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ClaimsHarness {...props} />
    </MemoryRouter>,
  );

const panel = () => screen.getByTestId('panel');
const pane = () => screen.getByTestId('pane');
const gclaim = () => new URLSearchParams(screen.getByTestId('qs').textContent ?? '').get('gclaim');
/** The strip renders each open claim as its title beside a `Close <id>` button. */
const tabEl = (id: string) => screen.getByLabelText(`Close ${id}`).parentElement as HTMLElement;
const tabLabel = (id: string, label: string) => within(tabEl(id)).getByText(label);

describe('GuardClaimsPane — preview, pin and deep links', () => {
  it('single-click previews the claim (italic tab + ?gclaim)', async () => {
    const user = userEvent.setup();
    renderClaims();
    await user.click(within(panel()).getByText(PROVEN.title));
    expect(gclaim()).toBe(PROVEN_ID);
    expect(tabLabel(PROVEN_ID, PROVEN.title)).toHaveClass('italic');
    expect(within(pane()).getByText(PROVEN.claim)).toBeInTheDocument();

    // A second single-click takes the transient slot — one preview tab only.
    await user.click(within(panel()).getByText(GAPPED.title));
    expect(screen.queryByLabelText(`Close ${PROVEN_ID}`)).not.toBeInTheDocument();
    expect(gclaim()).toBe(GAPPED_ID);
  });

  it('double-click pins the tab so the next preview coexists with it', async () => {
    const user = userEvent.setup();
    renderClaims();
    await user.dblClick(within(panel()).getByText(PROVEN.title));
    expect(tabLabel(PROVEN_ID, PROVEN.title)).toHaveClass('font-medium');
    await user.click(within(panel()).getByText(GAPPED.title));
    expect(tabLabel(PROVEN_ID, PROVEN.title)).toHaveClass('font-medium');
    expect(tabLabel(GAPPED_ID, GAPPED.title)).toHaveClass('italic');
    expect(gclaim()).toBe(GAPPED_ID);
  });

  it('a ?gclaim deep link lands on that claim’s detail', () => {
    renderClaims(`/repos/r?tab=guardclaims&gclaim=${encodeURIComponent(GAPPED_ID)}`);
    expect(within(pane()).getByText(GAPPED.claim)).toBeInTheDocument();
  });

  it('with nothing selected the pane IS the totals overview', () => {
    renderClaims();
    const overview = within(pane()).getByRole('region', { name: 'Claims overview' });
    expect(within(overview).getByText('claims')).toBeInTheDocument();
    expect(within(overview).getByText('proven')).toBeInTheDocument();
    expect(within(overview).getByText(/1 dismissed · 1 not claimed · 1 with an anchor/)).toBeInTheDocument();
    // The per-doc breakdown says WHERE the unproven part is.
    const docs = within(overview).getByRole('list', { name: 'Claims by document' });
    expect(within(docs).getByText(DOC)).toBeInTheDocument();
    expect(within(docs).getByText('2 claims · 1 proven · 1 not claimed')).toBeInTheDocument();
  });

  it('a refused statement is selectable, and its reason is what the pane says', async () => {
    const user = userEvent.setup();
    renderClaims();
    await user.click(within(panel()).getByText(UNTESTABLE_TEXT));
    expect(gclaim()).toBe(UNTESTABLE_ID);
    expect(within(pane()).getByText('Why it is not claimed')).toBeInTheDocument();
    expect(within(pane()).getByText(/running the product can neither confirm nor deny it/)).toBeInTheDocument();
  });

  it('before any extraction the pane is the shared empty state, naming the command', () => {
    renderClaims('/repos/r?tab=guardclaims', { view: EMPTY_VIEW });
    expect(within(pane()).getByText('No claims extracted yet')).toBeInTheDocument();
    expect(within(pane()).getByText('truecourse guard generate')).toBeInTheDocument();
    expect(within(panel()).getByText('No claims extracted yet.')).toBeInTheDocument();
  });
});

describe('GuardClaimDetail — the two traces', () => {
  it('renders the claim sentence, how to verify it, and what it needs', () => {
    renderClaims(`/repos/r?tab=guardclaims&gclaim=${encodeURIComponent(PROVEN_ID)}`);
    const detail = pane();
    expect(within(detail).getByText(PROVEN.claim)).toBeInTheDocument();
    expect(within(detail).getByText(PROVEN.verifyVia!)).toBeInTheDocument();
    for (const need of PROVEN.needs) expect(within(detail).getByText(need)).toBeInTheDocument();
    expect(within(detail).getByLabelText('claim notes')).toHaveTextContent(/Read out of the second paragraph/);
    // The machine detail closes the page, never leads it.
    expect(within(detail).getByText(PROVEN.contentHash)).toBeInTheDocument();
  });

  it('traces UP to the doc section that states it', async () => {
    const user = userEvent.setup();
    const opened: [string, string][] = [];
    renderClaims(`/repos/r?tab=guardclaims&gclaim=${encodeURIComponent(PROVEN_ID)}`, {
      onOpenSpec: (doc, anchor) => opened.push([doc, anchor]),
    });
    await user.click(within(pane()).getByText('Creating tasks'));
    expect(opened).toEqual([[DOC, CREATE_ANCHOR]]);
  });

  it('says plainly when the anchor no longer resolves in the live doc', () => {
    renderClaims(`/repos/r?tab=guardclaims&gclaim=${encodeURIComponent(ORPHANED_ID)}`);
    expect(within(pane()).getByText(/no longer resolves in the live document/)).toBeInTheDocument();
    // …and the dismissal is a marker of its own, never a coverage state.
    expect(within(pane()).getByText('Dismissed')).toBeInTheDocument();
  });

  it('traces DOWN to the flow that carries it and the scenario that proves it', async () => {
    const user = userEvent.setup();
    const flows: string[] = [];
    const tests: string[] = [];
    renderClaims(`/repos/r?tab=guardclaims&gclaim=${encodeURIComponent(PROVEN_ID)}`, {
      onOpenFlow: (id) => flows.push(id),
      onOpenTest: (id) => tests.push(id),
    });
    const detail = pane();
    // The flow row names WHERE in the flow the claim sits, and the note synthesis wrote.
    expect(within(detail).getByText('milestone 1')).toBeInTheDocument();
    expect(within(detail).getByText('· the add step carries it')).toBeInTheDocument();
    await user.click(within(detail).getByText(FLOW_TITLE));
    expect(flows).toEqual([FLOW_ID]);

    // The scenario row names the exact steps carrying the tag.
    expect(within(detail).getByText('steps 2, 3')).toBeInTheDocument();
    await user.click(within(detail).getByText(SCENARIO_TITLE));
    expect(tests).toEqual([SCENARIO_ID]);
  });

  it('a claim nothing carries says so on both traces, with the gap’s reason', () => {
    renderClaims(`/repos/r?tab=guardclaims&gclaim=${encodeURIComponent(GAPPED_ID)}`);
    const detail = pane();
    expect(within(detail).getByText('No flow carries this claim.')).toBeInTheDocument();
    expect(within(detail).getByText('No scenario step names this claim yet.')).toBeInTheDocument();
    expect(within(detail).getByText(GAPPED.gapReason!)).toBeInTheDocument();
  });
});

// --- The section detail's gapped claims --------------------------------------

/**
 * The coverage view's own claim surface: `guarded` outranks every gap status, so a
 * section with scenarios AND claims nothing carries used to report only its rank
 * and drop the gaps. They render beside the flows now, whatever the rank.
 */
describe('GuardSectionDetail — the claims a guarded section still leaves ungapped', () => {
  const SECTION: GuardSectionCoverage = {
    anchor: LIST_ANCHOR,
    headingText: 'Listing tasks',
    level: 2,
    fingerprint: 'sha256:aa',
    status: 'guarded',
    flows: [
      {
        flowId: FLOW_ID,
        title: FLOW_TITLE,
        status: 'guarded',
        epic: false,
        manual: false,
        milestonesInSection: [1],
        milestoneCount: 2,
        surfaces: [],
      },
    ],
    claimGaps: [
      { claimId: GAPPED_ID, title: GAPPED.title, reason: 'no cli journey lists tasks' },
      { reason: 'the section states an ordering the flows never reach' },
    ],
    scenarioIds: [SCENARIO_ID],
    scenarios: [],
  };

  const renderSection = (onOpenClaim?: (id: string) => void) =>
    render(
      <GuardSectionDetail
        section={SECTION}
        onOpenFlow={() => {}}
        {...(onOpenClaim ? { onOpenClaim } : {})}
        onClose={() => {}}
      />,
    );

  it('renders the gaps ALONGSIDE the flows, not instead of them', () => {
    renderSection();
    expect(screen.getByRole('list', { name: 'Flows through this section' })).toBeInTheDocument();
    const gaps = screen.getByRole('list', { name: 'Gapped claims in this section' });
    expect(within(gaps).getByText(GAPPED.title)).toBeInTheDocument();
    expect(within(gaps).getByText('no cli journey lists tasks')).toBeInTheDocument();
    // A generate gap that named no claim still reads — the reason is the whole row.
    expect(within(gaps).getByText('the section states an ordering the flows never reach')).toBeInTheDocument();
  });

  it('a gap that resolves to a claim opens it; one that names none is not a button', async () => {
    const user = userEvent.setup();
    const opened: string[] = [];
    renderSection((id) => opened.push(id));
    const gaps = screen.getByRole('list', { name: 'Gapped claims in this section' });
    await user.click(within(gaps).getByText(GAPPED.title));
    expect(opened).toEqual([GAPPED_ID]);
    // The claimless gap has nothing to open, so it never pretends to.
    const claimless = within(gaps)
      .getByText('the section states an ordering the flows never reach')
      .closest('[role="listitem"]') as HTMLElement;
    expect(claimless.tagName).toBe('DIV');
  });
});

// --- The step grouping a claim-tagged test needs -----------------------------

const CLAIM_STEPS: GuardScenarioStepView[] = [
  { n: 1, command: 'tasks init', expectation: 'exit 0' },
  { n: 2, command: 'tasks add "write the spec"', expectation: 'exit 0', claims: [PROVEN_ID] },
  { n: 3, command: 'tasks list', expectation: 'stdout contains “write the spec”', claims: [PROVEN_ID] },
  { n: 4, command: 'tasks list --sorted', expectation: 'exit 0', claims: [GAPPED_ID] },
];

describe('groupStepsByMilestone — a step names its milestone by position OR by identity', () => {
  it('keeps consecutive steps sharing a claim identity in ONE group', () => {
    const groups = groupStepsByMilestone(CLAIM_STEPS);
    expect(groups.map((g) => g.steps.map((s) => s.n))).toEqual([[1], [2, 3], [4]]);
    // The claim-tagged groups carry their identities, and no position at all.
    expect(groups.map((g) => g.milestone)).toEqual([null, null, null]);
    expect(groups.map((g) => [...g.claims])).toEqual([[], [PROVEN_ID], [GAPPED_ID]]);
  });

  it('still groups by POSITION when the step names one', () => {
    const groups = groupStepsByMilestone([
      { n: 1, command: 'a', expectation: 'exit 0' },
      { n: 2, command: 'b', expectation: 'exit 0', milestone: 1 },
      { n: 3, command: 'c', expectation: 'exit 0', milestone: 1 },
      { n: 4, command: 'd', expectation: 'exit 0', milestone: 2 },
    ]);
    expect(groups.map((g) => g.milestone)).toEqual([null, 1, 2]);
    expect(groups.map((g) => g.steps.length)).toEqual([1, 2, 1]);
  });

  it('a step naming NEITHER is the only thing that stays "Setup"', () => {
    const groups = groupStepsByMilestone(CLAIM_STEPS);
    expect(groups.filter((g) => g.milestone == null && g.claims.length === 0)).toHaveLength(1);
  });
});

describe('GuardTestView — a claim-tagged step list reads as its claims, not as Setup', () => {
  const MODEL: GuardTestViewModel = {
    id: 'tasks-manual',
    title: 'Adding a task lists it',
    status: guardTestStatusView({ status: 'pass' }),
    provenance: 'Latest state',
    binds: { doc: DOC, section: CREATE_ANCHOR },
    journeyPath: [],
    evidence: null,
    // Only the first identity is named by the corpus — the second must still read
    // as itself rather than falling back to a header that means "preparation".
    claimTitles: { [PROVEN_ID]: PROVEN.title },
  };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/scenario?'))
          return json({ id: MODEL.id, file: 'tasks.yaml', content: 'guard: 3', steps: CLAIM_STEPS });
        return json({});
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('heads each claim-identity group by the CLAIM, and only the untagged step by Setup', async () => {
    render(<GuardTestView repoId="r" test={MODEL} journeys={null} onOpenSpec={() => {}} />);
    const steps = await screen.findByLabelText('test steps');
    await within(steps).findAllByRole('listitem');

    expect(within(steps).getByText(PROVEN.title)).toBeInTheDocument();
    // An id the corpus doesn't name renders as the id — never blank, never "Setup".
    expect(within(steps).getByText(GAPPED_ID)).toBeInTheDocument();
    // Exactly ONE Setup header, over the one step that names no milestone at all.
    expect(within(steps).getAllByText('Setup')).toHaveLength(1);
    expect(within(steps).getAllByRole('listitem')).toHaveLength(CLAIM_STEPS.length);
  });
});
