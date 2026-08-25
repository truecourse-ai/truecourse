/**
 * Guard CLAIM tests, on the governing model:
 *
 *   a claim is one testable statement a doc makes, and it is only worth reading
 *   if both of its traces are readable — UP to the section that states it, DOWN to
 *   the flows and scenario steps that prove it.
 *
 * Claims have NO tab of their own: they are read WHERE the reader already is, so
 * these tests cover the coverage surface's half of the story — a section's detail
 * lists the claims that section states (each one the doc's sentence and nothing
 * else — a claim carries no status of its own — beside the statements extraction
 * refused), clicking one drills into the claim itself (both traces, as real
 * jumps) and Back returns to the section. Then the routes in: a `?gclaim=` deep
 * link that names only the claim resolves to its doc + section, and the corpus
 * totals live on the coverage overview.
 *
 * Plus the step-grouping fix the claim corpus made necessary: a step tagged with a
 * claim IDENTITY rather than a milestone POSITION is not preparation, so its group
 * must never head "Prepare".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type {
  GuardClaimRow,
  GuardClaimsView,
  GuardDocCoverage,
  GuardScenarioStepView,
  GuardSectionCoverage,
  GuardStaleness,
} from '@truecourse/shared';
import { GuardCoveragePage } from '@/components/guard/GuardCoveragePage';
import { GuardSectionDetail } from '@/components/guard/GuardSectionDetail';
import { GuardTestView, type GuardTestViewModel } from '@/components/guard/GuardTestView';
import { useGuardCoverageTabs } from '@/hooks/useGuardCoverageTabs';
import type { SpecCorpusState } from '@/components/spec/SpecCorpusView';
import { guardTestStatusView } from '@/lib/guard-flow-status';
import { guardUntestableEntries } from '@/lib/guard-claims';

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
  headingText: 'Listing tasks',
  anchorLive: true,
  coverage: 'gapped',
  gapReason: 'no cli interface lists tasks',
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

// --- The section detail: a section's claims, read where they are stated -------

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
    { claimId: GAPPED_ID, title: GAPPED.title, reason: 'no cli interface lists tasks' },
    { reason: 'the section states an ordering the flows never reach' },
  ],
  scenarioIds: [SCENARIO_ID],
  scenarios: [],
};

/** The other doc's section — it states the dismissed, orphaned-anchor claim. */
const REMIND_SECTION: GuardSectionCoverage = {
  anchor: REMIND_ANCHOR,
  headingText: 'Scheduling reminders',
  level: 2,
  fingerprint: 'sha256:cc',
  status: 'unguarded',
  flows: [],
  scenarioIds: [],
  scenarios: [],
};

/** The section that STATES the proven claim (and the one refused statement). */
const CREATE_SECTION: GuardSectionCoverage = {
  anchor: CREATE_ANCHOR,
  headingText: 'Creating tasks',
  level: 2,
  fingerprint: 'sha256:bb',
  status: 'pass',
  flows: [],
  scenarioIds: [],
  scenarios: [],
};

function renderSection(
  section: GuardSectionCoverage,
  props: Partial<Parameters<typeof GuardSectionDetail>[0]> = {},
) {
  return render(
    <GuardSectionDetail repoId="r"
      section={section}
      doc={DOC}
      claims={VIEW.claims}
      untestable={guardUntestableEntries(VIEW)}
      onOpenFlow={() => {}}
      onClose={() => {}}
      {...props}
    />,
  );
}

const claimList = () => screen.getByRole('list', { name: 'Claims in this section' });

describe('GuardSectionDetail — the claims a section states', () => {
  it('lists them ALONGSIDE the flows, whatever the section’s own status ranks', () => {
    renderSection(SECTION);
    expect(screen.getByRole('list', { name: 'Flows through this section' })).toBeInTheDocument();
    const claims = claimList();
    // The stored claim reads as itself: its title and the sentence the doc states.
    expect(within(claims).getByText(GAPPED.title)).toBeInTheDocument();
    expect(within(claims).getByText(GAPPED.claim)).toBeInTheDocument();
    // A generate gap that named no claim still reads — the reason is the whole row.
    expect(within(claims).getByText('the section states an ordering the flows never reach')).toBeInTheDocument();
    // Another section's claims never leak in.
    expect(within(claims).queryByText(PROVEN.title)).not.toBeInTheDocument();
  });

  it('lists a PROVEN claim too — a section shows what it promises, not only its holes', () => {
    renderSection(CREATE_SECTION);
    const claims = claimList();
    expect(within(claims).getByText(PROVEN.title)).toBeInTheDocument();
    expect(within(claims).getByText(PROVEN.claim)).toBeInTheDocument();
    // …and the statements extraction REFUSED close the list, under their own group.
    expect(screen.getByText('Not claimed')).toBeInTheDocument();
    expect(within(claims).getByText(UNTESTABLE_TEXT)).toBeInTheDocument();
    expect(within(claims).getByText(/value statement/)).toBeInTheDocument();
  });

  // A claim has no state of its own: no coverage dot, no chip, no recorded gap
  // reason. Whatever stands behind it is the traces in its detail, and a colour
  // in a list can only pretend to summarize them.
  it('renders a claim row as STATELESS text — no dot, no chip, no gap reason', () => {
    renderSection(SECTION);
    const row = within(claimList()).getByText(GAPPED.title).closest('[role="listitem"]') as HTMLElement;
    expect(row).toHaveTextContent(GAPPED.claim);
    expect(row).not.toHaveTextContent(GAPPED.gapReason!);
    expect(row.querySelectorAll('.rounded-full')).toHaveLength(0);
    expect(row.textContent).not.toMatch(/gapped|proven|planned|unplanned|needs/i);
  });

  it('a gap that names no claim is not clickable; a stored claim is', async () => {
    const user = userEvent.setup();
    const opened: (string | null)[] = [];
    renderSection(SECTION, { onSelectClaim: (id) => opened.push(id) });
    const claims = claimList();
    await user.click(within(claims).getByText(GAPPED.title));
    expect(opened).toEqual([GAPPED_ID]);
    // The claimless gap has nothing to open, so it never pretends to.
    const claimless = within(claims)
      .getByText('the section states an ordering the flows never reach')
      .closest('[role="listitem"]') as HTMLElement;
    expect(claimless).not.toHaveAttribute('tabindex');
    await user.click(claimless);
    expect(opened).toEqual([GAPPED_ID]);
  });
});

describe('GuardSectionDetail — the claim drill-in (both traces, without leaving the doc)', () => {
  it('renders the claim sentence, how to verify it, and its id — and no status', () => {
    renderSection(CREATE_SECTION, { activeClaimId: PROVEN_ID });
    expect(screen.getByText(PROVEN.claim)).toBeInTheDocument();
    expect(screen.getByText(PROVEN.verifyVia!)).toBeInTheDocument();
    // Stateless: the coverage chip, the needs chips and the notes block are gone.
    expect(screen.queryByText('Proven')).not.toBeInTheDocument();
    expect(screen.queryByText('Needs')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('claim notes')).not.toBeInTheDocument();
    // The machine detail closes the page, never leads it.
    expect(screen.getByText(PROVEN.contentHash)).toBeInTheDocument();
    // The section's own list is replaced by the claim — one panel, two levels.
    expect(screen.queryByRole('list', { name: 'Claims in this section' })).not.toBeInTheDocument();
  });

  it('Back returns to the section that states it', async () => {
    const user = userEvent.setup();
    const opened: (string | null)[] = [];
    renderSection(CREATE_SECTION, { activeClaimId: PROVEN_ID, onSelectClaim: (id) => opened.push(id) });
    // The Back control names the section it returns to.
    const back = screen.getByLabelText('Back to the section');
    expect(back).toHaveTextContent('Creating tasks');
    await user.click(back);
    expect(opened).toEqual([null]);
  });

  it('traces DOWN to the flow that carries it and the scenario that proves it', async () => {
    const user = userEvent.setup();
    const flows: string[] = [];
    renderSection(CREATE_SECTION, {
      activeClaimId: PROVEN_ID,
      onOpenFlow: (id) => flows.push(id),
    });
    // The flow row names WHERE in the flow the claim sits, and the note synthesis wrote.
    expect(screen.getByText('milestone 1')).toBeInTheDocument();
    expect(screen.getByText('· the add step carries it')).toBeInTheDocument();
    await user.click(screen.getByText(FLOW_TITLE));
    expect(flows).toEqual([FLOW_ID]);

    // The scenario row names the exact steps carrying the tag — and goes nowhere:
    // a test is read inside its flow, which the row above already opens.
    expect(screen.getByText('steps 2, 3')).toBeInTheDocument();
    expect(screen.getByText(SCENARIO_TITLE).closest('button')).toBeNull();
  });

  it('traces UP to the doc section that states it', async () => {
    const user = userEvent.setup();
    const opened: [string, string][] = [];
    renderSection(CREATE_SECTION, {
      activeClaimId: PROVEN_ID,
      onOpenSpec: (doc, anchor) => opened.push([doc, anchor]),
    });
    // The source line names the section; the Back control names it too, so the
    // jump is taken from the detail's own header line.
    await user.click(screen.getByText(`· ${DOC}`));
    expect(opened).toEqual([[DOC, CREATE_ANCHOR]]);
  });

  it('a claim nothing carries says so on both traces — the empty traces ARE the answer', () => {
    renderSection(SECTION, { activeClaimId: GAPPED_ID });
    expect(screen.getByText('No flow carries this claim.')).toBeInTheDocument();
    expect(screen.getByText('No scenario step names this claim yet.')).toBeInTheDocument();
    // No coverage verdict is restated over them, and no gap reason beside them.
    expect(screen.queryByText('Coverage')).not.toBeInTheDocument();
    expect(screen.queryByText(GAPPED.gapReason!)).not.toBeInTheDocument();
  });

  it('a DISMISSED claim wears no chip either — a decision is not the claim’s state', () => {
    renderSection(REMIND_SECTION, { doc: OTHER_DOC, activeClaimId: ORPHANED_ID });
    expect(screen.getByText(ORPHANED.claim)).toBeInTheDocument();
    expect(screen.queryByText('Dismissed')).not.toBeInTheDocument();
  });

  it('a refused statement drills in the same way — what it said and why it is not a claim', () => {
    const untestableId = guardUntestableEntries(VIEW)[0].id;
    renderSection(CREATE_SECTION, { activeClaimId: untestableId });
    expect(screen.getByText('Why it is not claimed')).toBeInTheDocument();
    expect(screen.getByText(/running the product can neither confirm nor deny it/)).toBeInTheDocument();
  });

  // A claim's truth is its entry in scenarios/claims.json, so the drill-in offers
  // the SAME two readings every artifact-backed entity does — and no third.
  describe('the two readings of a claim', () => {
    const CLAIM_RAW = JSON.stringify({ id: PROVEN_ID, contentHash: PROVEN.contentHash }, null, 2);
    beforeEach(() =>
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL) =>
          String(url).includes('/guard/claim/raw')
            ? json({ id: PROVEN_ID, file: 'claims.json', content: CLAIM_RAW })
            : json({}),
        ),
      ),
    );
    afterEach(() => vi.unstubAllGlobals());

    it('switches between the page and the stored claim entry, defaulting to the page', async () => {
      const user = userEvent.setup();
      renderSection(CREATE_SECTION, { activeClaimId: PROVEN_ID });

      const modes = screen.getByRole('group', { name: 'View mode' });
      expect(within(modes).getAllByRole('button').map((b) => b.textContent)).toEqual(['View', 'JSON']);
      expect(within(modes).getByRole('button', { name: 'View' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.queryByLabelText('claim source')).not.toBeInTheDocument();

      await user.click(within(modes).getByRole('button', { name: 'JSON' }));
      await waitFor(() => expect(screen.getByLabelText('claim source')).toHaveTextContent(PROVEN.contentHash));
      // The stored file REPLACES the page — never two readings at once.
      expect(screen.queryByText('Carried by flows')).not.toBeInTheDocument();
      expect(screen.queryByText(PROVEN.claim)).not.toBeInTheDocument();

      await user.click(within(modes).getByRole('button', { name: 'View' }));
      expect(screen.getByText('Carried by flows')).toBeInTheDocument();
    });

    it('offers NO mode switch on a refused statement — nothing in the store addresses it', () => {
      const untestableId = guardUntestableEntries(VIEW)[0].id;
      renderSection(CREATE_SECTION, { activeClaimId: untestableId });
      expect(screen.queryByRole('group', { name: 'View mode' })).not.toBeInTheDocument();
    });
  });
});

// --- The coverage page: the routes IN --------------------------------------

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const MD = ['# Tasks', '', '## Creating tasks', 'Adding writes the task.', '', '## Listing tasks', 'Newest first.'].join(
  '\n',
);

const COVERAGE: GuardDocCoverage = {
  doc: DOC,
  markdown: true,
  sections: [CREATE_SECTION, SECTION],
  orphanedSections: [],
  totals: {
    pass: 1,
    fail: 0,
    error: 0,
    stale: 0,
    orphaned: 0,
    guarded: 1,
    web: 0,
    tui: 0,
    'blocked-on': 0,
    untestable: 0,
    'no-claim': 0,
    dismissed: 0,
    unguarded: 0,
  },
  runId: 'run1',
  ranAt: '2026-08-05T13:40:00.000Z',
  generatedAt: '2026-08-05T13:40:00.000Z',
};

const CORPUS = {
  data: {
    corpus: {
      version: 1,
      generatedAt: '',
      // TWO docs: with a run and a LONE doc the page opens it straight away, and
      // the overview these tests are about would never render.
      docs: [
        { ref: DOC, kind: 'unknown', lastTouched: '', areaTags: [] },
        { ref: OTHER_DOC, kind: 'unknown', lastTouched: '', areaTags: [] },
      ],
      areas: [],
    },
  },
  hydrating: false,
  scanning: false,
  error: null,
  corpusCommit: null,
  scan: async () => {},
  refetch: async () => {},
  apply: () => {},
} as unknown as SpecCorpusState;

const STALENESS: GuardStaleness = {
  generateStale: false,
  runStale: false,
  hasCorpus: true,
  hasScenarios: true,
  hasGenerated: true,
  hasRun: true,
};

function CoverageHarness({ view = VIEW }: { view?: GuardClaimsView }) {
  const tabs = useGuardCoverageTabs('r');
  const loc = useLocation();
  return (
    <div>
      <span data-testid="qs">{loc.search}</span>
      <GuardCoveragePage
        repoId="r"
        corpus={CORPUS}
        staleness={STALENESS}
        staleLoaded
        tabs={tabs}
        claims={view}
        untestable={guardUntestableEntries(view)}
      />
    </div>
  );
}

const renderCoverage = (url: string, props: Parameters<typeof CoverageHarness>[0] = {}) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <CoverageHarness {...props} />
    </MemoryRouter>,
  );

const qs = () => new URLSearchParams(screen.getByTestId('qs').textContent ?? '');

describe('GuardCoveragePage — a claim is reached through its section', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/coverage')) return json(COVERAGE);
        if (u.includes('/spec/doc')) return json({ ref: DOC, content: MD });
        return json({});
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a ?gclaim deep link that names only the claim lands on its doc, its section, and the claim', async () => {
    renderCoverage(`/repos/r?section=guard&tab=coverage&gclaim=${encodeURIComponent(GAPPED_ID)}`);
    // The claim's detail is open…
    expect(await screen.findByText(GAPPED.claim)).toBeInTheDocument();
    // …and the URL now names all three, so a reload lands in the same place.
    expect(qs().get('guard')).toBe(DOC);
    expect(qs().get('gsec')).toBe(LIST_ANCHOR);
    expect(qs().get('gclaim')).toBe(GAPPED_ID);
  });

  it('selecting a claim from the section writes ?gclaim, and Back clears it', async () => {
    const user = userEvent.setup();
    renderCoverage(`/repos/r?section=guard&tab=coverage&guard=${encodeURIComponent(DOC)}&gsec=${LIST_ANCHOR}`);
    const claims = await screen.findByRole('list', { name: 'Claims in this section' });
    await user.click(within(claims).getByText(GAPPED.title));
    expect(qs().get('gclaim')).toBe(GAPPED_ID);
    expect(screen.getByText(GAPPED.claim)).toBeInTheDocument();

    await user.click(screen.getByLabelText('Back to the section'));
    expect(qs().get('gclaim')).toBeNull();
    expect(screen.getByRole('list', { name: 'Claims in this section' })).toBeInTheDocument();
  });

  it('with no document open the pane rests on the Overview — claim totals, never a second claim LIST', async () => {
    // The overview carries the claim TOTALS (the coverage ledger) and stops
    // there: the per-claim inventory lives inside the section that states each
    // claim, and a list here would be the parallel inventory this pane keeps
    // growing back.
    renderCoverage('/repos/r?section=guard&tab=coverage');
    expect(await screen.findByText('Coverage overview')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Claims by document' })).toBeNull();
  });

  it('renders the Overview without a Claims panel before any extraction', async () => {
    renderCoverage('/repos/r?section=guard&tab=coverage', { view: EMPTY_VIEW });
    expect(await screen.findByText('Coverage overview')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Claims' })).toBeNull();
  });
});

// --- The step grouping a claim-tagged test needs -----------------------------

const CLAIM_STEPS: GuardScenarioStepView[] = [
  { n: 1, command: 'tasks init', expectation: 'exit 0' },
  { n: 2, command: 'tasks add "write the spec"', expectation: 'exit 0', claims: [PROVEN_ID] },
  { n: 3, command: 'tasks list', expectation: 'stdout contains “write the spec”', claims: [PROVEN_ID] },
  { n: 4, command: 'tasks list --sorted', expectation: 'exit 0', claims: [GAPPED_ID] },
];

describe('GuardTestView — a claim-tagged step reads its claims inside its record', () => {
  const MODEL: GuardTestViewModel = {
    id: 'tasks-manual',
    title: 'Adding a task lists it',
    status: guardTestStatusView({ status: 'pass' }),
    provenance: 'Latest state',
    binds: { doc: DOC, section: CREATE_ANCHOR },
    interfacePath: [],
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
          return json({ id: MODEL.id, file: 'tasks.yaml', content: `id: ${MODEL.id}`, steps: CLAIM_STEPS });
        return json({});
      }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('names the claim inside the tagged step — the corpus title, or the bare id', async () => {
    const user = userEvent.setup();
    render(<GuardTestView repoId="r" test={MODEL} interfaces={null} onOpenSpec={() => {}} />);
    const steps = await screen.findByLabelText('test steps');
    await within(steps).findAllByRole('listitem');

    // The closed list is steps alone — no group headers of any kind.
    expect(within(steps).queryByText('Prepare')).toBeNull();
    expect(within(steps).queryByText('Checks')).toBeNull();
    expect(within(steps).getAllByRole('listitem')).toHaveLength(CLAIM_STEPS.length);

    // The corpus-named claim reads inside its step's record…
    await user.click(within(steps).getByRole('button', { name: 'Step 2 record' }));
    expect(
      within(document.getElementById('guard-step-body-2')!).getByText(PROVEN.title),
    ).toBeInTheDocument();
    // …and an id the corpus doesn't name renders as the id — never blank.
    await user.click(within(steps).getByRole('button', { name: 'Step 4 record' }));
    expect(
      within(document.getElementById('guard-step-body-4')!).getByText(GAPPED_ID),
    ).toBeInTheDocument();
  });

  /**
   * A drawer promises a reading. This model carries NO evidence ref at all (a test
   * whose run captured nothing, and every test read before a run existed), so the
   * transcript drawer must not be offered — an opened drawer with nothing behind
   * it is the one thing worse than no drawer.
   */
  it('offers no Transcript drawer when the test has no evidence at all', async () => {
    render(<GuardTestView repoId="r" test={MODEL} interfaces={null} onOpenSpec={() => {}} />);
    const steps = await screen.findByLabelText('test steps');
    await within(steps).findAllByRole('listitem');

    expect(screen.queryByRole('button', { name: /^Transcript/ })).toBeNull();
    expect(screen.queryByLabelText('evidence transcript')).toBeNull();
    // The interfaces drawer still reads — it is a fact about the test, not the run.
    expect(screen.getByRole('button', { name: /^Interfaces/ })).toBeInTheDocument();
  });

  it('an untagged step opens without any claim line — nothing invented for it', async () => {
    const user = userEvent.setup();
    render(<GuardTestView repoId="r" test={MODEL} interfaces={null} onOpenSpec={() => {}} />);
    const steps = await screen.findByLabelText('test steps');
    await within(steps).findAllByRole('listitem');

    await user.click(within(steps).getByRole('button', { name: 'Step 1 record' }));
    const body = document.getElementById('guard-step-body-1')!;
    expect(within(body).queryByText(PROVEN.title)).toBeNull();
    expect(within(body).queryByText(GAPPED_ID)).toBeNull();
    expect(within(body).queryByText(/Prepare|Checks/)).toBeNull();
  });
});
