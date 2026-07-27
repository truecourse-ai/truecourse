/**
 * Guard JOURNEYS-tab tests — the code half's read surface and its one FREE action.
 * Covers the unmapped empty state and the Map swap (the POST answers with the
 * fresh catalog, so the tab re-renders from the response — no refetch, no socket),
 * the detected-surface banner (only surfaces this repo actually has: runnable ✓ /
 * awaiting ⚠ / journey count), the per-surface catalog with the reverse index onto
 * the flows, the sequence diagram, and the "Used by flows" click-through into the
 * Flows tab.
 *
 * Fixture: the plan's taskbird cli catalog — three grounded journeys plus one no
 * flow mentions (the candidate spec gap).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { GuardJourneysView } from '@truecourse/shared';
import { GuardJourneysPanel } from '@/components/guard/GuardJourneysPanel';
import { GuardJourneysPane } from '@/components/guard/GuardJourneysPane';
import { useGuardJourneys } from '@/hooks/useGuardJourneys';
import { useGuardJourneyTabs } from '@/hooks/useGuardJourneyTabs';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const FLOW_ID = 'task-lifecycle';
const SCENARIO_ID = 'task-lifecycle.cli.1';

/** The wire always carries a row per registry driver — the banner shows only the detected ones. */
const SURFACES: GuardJourneysView['surfaces'] = [
  { surface: 'cli', label: 'CLI', runnable: true, journeys: 5, detected: true, source: 'tree' },
  { surface: 'api', label: 'API', runnable: true, journeys: 0, detected: false },
  { surface: 'web', label: 'Web', runnable: false, waitingLabel: 'Needs web driver', journeys: 0, detected: false },
  { surface: 'desktop', label: 'Desktop', runnable: false, waitingLabel: 'Needs desktop driver', journeys: 0, detected: false },
];

const FLOW_TITLE = 'A user creates a task, sees it listed, and completes it';
const BLOCKED_FLOW_ID = 'manage-telemetry-settings';

/** A realized usage — a committed scenario grounds on the journey. */
const usedBy = (flowId: string, title: string) => ({ flowId, title, realized: true });

const journey = (
  slug: string,
  title: string,
  flags: string[],
  flows: GuardJourneysView['journeys'][number]['flows'],
) => ({
  id: `cli/${slug}`,
  type: 'cli' as const,
  title,
  entry: { command: title.split(' ') },
  steps: [{ kind: 'invoke' as const, command: title.split(' '), flags }],
  fingerprint: `sha256:${slug}`,
  flows,
  scenarioIds: flows.some((f) => f.realized) ? [SCENARIO_ID] : [],
  source: 'tree' as const,
});

const MAPPED: GuardJourneysView = {
  mapped: true,
  generatedAt: '2026-07-24T13:39:00.000Z',
  recipeFingerprint: 'sha256:r',
  journeys: [
    journey('tasks-add', 'tasks add', ['--json'], [usedBy(FLOW_ID, FLOW_TITLE)]),
    journey('tasks-list', 'tasks list', ['--done'], [usedBy(FLOW_ID, FLOW_TITLE)]),
    journey('tasks-done', 'tasks done', [], [usedBy(FLOW_ID, FLOW_TITLE)]),
    journey('tasks-purge', 'tasks purge', ['--force'], []),
    // Matched by a flow whose authoring was refused — used, never exercised.
    journey('telemetry', 'tasks telemetry', [], [
      {
        flowId: BLOCKED_FLOW_ID,
        title: 'A user turns telemetry off and it stays off',
        realized: false,
        gap: {
          kind: 'blocked-on',
          reason: 'blocked on credentials: A user turns telemetry off',
          label: 'blocked on',
        },
      },
    ]),
  ],
  surfaces: SURFACES,
  totals: { journeys: 5, detectedSurfaces: 1, grounded: 4, ungrounded: 1 },
};

/** A repo with two surfaces found — one runnable today, one still awaiting its driver. */
const CLI_AND_WEB: GuardJourneysView = {
  ...MAPPED,
  journeys: [
    ...MAPPED.journeys,
    {
      id: 'web/tasks-board',
      type: 'web',
      title: 'Task board',
      entry: { command: ['web'] },
      steps: [{ kind: 'navigate', route: '/tasks' }],
      fingerprint: 'sha256:web-tasks-board',
      flows: [],
      scenarioIds: [],
      source: 'probes',
    },
  ],
  surfaces: SURFACES.map((s) =>
    s.surface === 'web' ? { ...s, journeys: 1, detected: true, source: 'probes' as const } : s,
  ),
  totals: { journeys: 6, detectedSurfaces: 2, grounded: 4, ungrounded: 2 },
};

/**
 * The 2026-07-27 report: a journey grounded by a test whose flow the corpus
 * can't name rendered the raw TEST ID as loose text beside real chips.
 */
const ORPHAN_TEST_ID = 'run-the-community-edition-without-the-ee-directory.cli.1';
const MIXED_REFS: GuardJourneysView = {
  ...MAPPED,
  journeys: [
    {
      ...MAPPED.journeys[0],
      id: 'cli/tasks-add',
      flows: [usedBy(FLOW_ID, FLOW_TITLE)],
      scenarioIds: [SCENARIO_ID, ORPHAN_TEST_ID],
    },
  ],
};

const UNMAPPED: GuardJourneysView = {
  mapped: false,
  generatedAt: null,
  recipeFingerprint: null,
  journeys: [],
  surfaces: SURFACES.map((s) => ({ ...s, journeys: 0, detected: false })),
  totals: { journeys: 0, detectedSurfaces: 0, grounded: 0, ungrounded: 0 },
};

/** GET returns the unmapped catalog; POST /guard/map answers with the fresh one. */
function stubMapFlow() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? 'GET'} ${u}`);
      if (u.includes('/guard/map')) return json(MAPPED);
      if (u.includes('/guard/journeys')) return json(UNMAPPED);
      return json({});
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

/** The tab exactly as RepoPage wires it: one hook feeding panel + pane. */
function JourneysHarness({ onOpenFlow = () => {} }: { onOpenFlow?: (flowId: string) => void }) {
  const journeys = useGuardJourneys('r', true);
  const tabs = useGuardJourneyTabs('r');
  const loc = useLocation();
  return (
    <div>
      <span data-testid="search">{loc.search}</span>
      <div data-testid="panel">
        <GuardJourneysPanel
          journeys={journeys.view?.journeys ?? []}
          loading={journeys.loading}
          error={journeys.error}
          activeId={tabs.activeId}
          onOpen={tabs.open}
        />
      </div>
      <GuardJourneysPane
        view={journeys.view}
        loading={journeys.loading}
        error={journeys.error}
        mapping={journeys.mapping}
        onMap={() => void journeys.map()}
        tabs={tabs}
        onOpenFlow={onOpenFlow}
      />
    </div>
  );
}

const renderTab = (url = '/repos/r?tab=journeys', onOpenFlow?: (flowId: string) => void) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <JourneysHarness onOpenFlow={onOpenFlow} />
    </MemoryRouter>,
  );

/** The pane alone on a fixed view — for banner states the fetch fixtures don't carry. */
function PaneHarness({ view }: { view: GuardJourneysView }) {
  const tabs = useGuardJourneyTabs('r');
  return (
    <GuardJourneysPane
      view={view}
      loading={false}
      error={null}
      mapping={false}
      onMap={() => {}}
      tabs={tabs}
      onOpenFlow={() => {}}
    />
  );
}

const renderPane = (view: GuardJourneysView) =>
  render(
    <MemoryRouter initialEntries={['/repos/r?tab=journeys']}>
      <PaneHarness view={view} />
    </MemoryRouter>,
  );

const search = () => screen.getByTestId('search').textContent ?? '';

describe('Journeys tab — unmapped → Map → mapped', () => {
  it('offers the free Map CTA while nothing is mapped, then swaps in the response', async () => {
    const user = userEvent.setup();
    const calls = stubMapFlow();
    renderTab();

    expect(await screen.findByText('No journeys mapped yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Map · free, no LLM' }));

    // The catalog arrives from the POST itself — no follow-up GET.
    expect(await within(screen.getByTestId('panel')).findByText('cli/tasks-add')).toBeInTheDocument();
    expect(calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
    expect(calls.filter((c) => c.includes('/guard/journeys'))).toHaveLength(1);
  });
});

describe('Journeys tab — the detected-surface banner', () => {
  it('keeps a detected surface that is still awaiting its driver, and drops the undetected ones', () => {
    renderPane(CLI_AND_WEB);
    expect(screen.getByText(/CLI · runnable ✓/)).toHaveTextContent('· 5');
    const web = screen.getByText(/Web · Needs web driver ⚠/);
    expect(web).toHaveTextContent('· 1');
    // The wire still carries API / Desktop rows; undetected, they say nothing.
    expect(screen.queryByText(/API · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/Needs desktop driver/)).not.toBeInTheDocument();
  });

  it('renders nothing at all when no surface was detected — not an empty banner shell', () => {
    renderPane(UNMAPPED);
    expect(screen.queryByText('Detected surfaces')).not.toBeInTheDocument();
    // The unmapped empty state is the whole tab in that case.
    expect(screen.getByText('No journeys mapped yet')).toBeInTheDocument();
  });
});

describe('Journeys tab — the mapped catalog', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => (String(url).includes('/guard/journeys') ? json(MAPPED) : json({}))),
    );
  });

  it('banners only the surfaces this repo has, with their state and journey count', async () => {
    renderTab();
    const cli = await screen.findByText(/CLI · runnable ✓/);
    expect(cli).toHaveTextContent('· 5');
    // Drivers with no code behind them are engine knowledge, not user information.
    expect(screen.queryByText(/Web · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/API · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/Desktop · /)).not.toBeInTheDocument();
    expect(screen.queryByText(/Needs .* driver/)).not.toBeInTheDocument();
  });

  it('groups the catalog by surface and carries the reverse index onto the flows', async () => {
    renderTab();
    const list = await screen.findByRole('list', { name: 'Journey catalog' });
    expect(within(list).getByText('CLI · tree')).toBeInTheDocument();
    // Four journeys are used by one flow each — the three realized ones AND the
    // one whose flow matched but was blocked before a scenario could be written.
    expect(within(list).getAllByText('1 flow')).toHaveLength(4);
    // Nothing references `tasks purge` — the candidate spec gap.
    expect(within(list).getByText('0 flows')).toBeInTheDocument();
  });

  it('previews a journey as a sequence diagram and links the flows that use it', async () => {
    const user = userEvent.setup();
    const onOpenFlow = vi.fn();
    renderTab('/repos/r?tab=journeys', onOpenFlow);
    await user.click(await within(screen.getByTestId('panel')).findByText('cli/tasks-add'));
    expect(search()).toContain('gjourney=cli%2Ftasks-add');

    const diagram = await screen.findByRole('group', { name: 'Journey cli/tasks-add' });
    // Participants read in product words: the person, then the surface's registry label.
    expect(within(diagram).getByText('User')).toBeInTheDocument();
    expect(within(diagram).getByText('CLI')).toBeInTheDocument();
    expect(within(diagram).queryByText('You')).not.toBeInTheDocument();
    expect(within(diagram).getByText('tasks add --json')).toBeInTheDocument();

    expect(screen.getByText('Used by flows')).toBeInTheDocument();
    // The flow reads by TITLE, not by its engine id — and wears the SAME status
    // chip the Flows list wears (one vocabulary, one chip component).
    await user.click(screen.getByRole('button', { name: new RegExp(FLOW_TITLE) }));
    expect(onOpenFlow).toHaveBeenCalledWith(FLOW_ID);
  });

  it('a journey used only by a BLOCKED flow reads as used, and says what it needs', async () => {
    const user = userEvent.setup();
    const onOpenFlow = vi.fn();
    renderTab('/repos/r?tab=journeys&gjourney=cli%2Ftelemetry', onOpenFlow);

    expect(await screen.findByText('Used by flows')).toBeInTheDocument();
    // NOT the "spec never mentions this code path" line — the spec does mention it.
    expect(screen.queryByText(/the spec never mentions this code path/)).not.toBeInTheDocument();
    expect(screen.getByText('A user turns telemetry off and it stays off')).toBeInTheDocument();
    // The status WORD comes from the one vocabulary; the need is the sentence
    // beside it — never a bespoke "— blocked (…)" phrasing of its own.
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('needs credentials')).toBeInTheDocument();
    expect(screen.queryByText(/— blocked \(/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /A user turns telemetry off and it stays off/ }));
    expect(onOpenFlow).toHaveBeenCalledWith(BLOCKED_FLOW_ID);
  });

  it('renders EVERY reference as the same chip — an unnameable flow chips its id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) =>
        String(url).includes('/guard/journeys') ? json(MIXED_REFS) : json({}),
      ),
    );
    renderTab('/repos/r?tab=journeys&gjourney=cli%2Ftasks-add');
    expect(await screen.findByText('Used by flows')).toBeInTheDocument();

    // Two uniform chips: the named flow, and the one recovered from a test id —
    // chipped by its FLOW id, never by the test id, never as bare text.
    const named = screen.getByRole('button', { name: new RegExp(FLOW_TITLE) });
    const recovered = screen.getByRole('button', {
      name: /run-the-community-edition-without-the-ee-directory/,
    });
    expect(named.className).toBe(recovered.className);
    expect(recovered).not.toHaveTextContent(ORPHAN_TEST_ID);
    // The bare id line is gone for good.
    expect(screen.queryByText(SCENARIO_ID)).not.toBeInTheDocument();
  });

  it('scrolls a deep-linked journey row into view — the cross-navigation rule', async () => {
    const scrolled: Element[] = [];
    const spy = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(function (this: Element) {
        scrolled.push(this);
      });
    renderTab('/repos/r?tab=journeys&gjourney=cli%2Ftasks-done');
    await screen.findByRole('list', { name: 'Journey catalog' });
    expect(scrolled.some((el) => el.textContent?.includes('cli/tasks-done'))).toBe(true);
    spy.mockRestore();
  });

  it('has exactly ONE scroll container, like every other list panel', async () => {
    renderTab();
    const list = await screen.findByRole('list', { name: 'Journey catalog' });
    // The list itself scrolls — DOWN only, x clipped — and nothing between it and
    // the panel root does.
    expect(list.className).toMatch(/overflow-y-auto/);
    expect(list.className).toMatch(/overflow-x-hidden/);
    for (let el = list.parentElement; el; el = el.parentElement) {
      if (el.tagName === 'BODY') break;
      expect(el.className).not.toMatch(/overflow-(auto|scroll|y-auto|y-scroll)/);
    }
    // …and no inner overflow box under it either (the double-scrollbar report).
    for (const child of Array.from(list.querySelectorAll<HTMLElement>('*'))) {
      expect(child.className).not.toMatch(/overflow-(auto|scroll|y-auto|y-scroll)/);
    }
  });

  it('a ?gjourney deep link opens the journey, and one NO flow references says so', async () => {
    renderTab('/repos/r?tab=journeys&gjourney=cli%2Ftasks-purge');
    expect(await screen.findByRole('group', { name: 'Journey cli/tasks-purge' })).toBeInTheDocument();
    // Reserved for zero references of any kind — realized or merely planned.
    expect(screen.getAllByText(/No flow uses this journey/).length).toBeGreaterThan(0);
    expect(screen.getByText(/the spec never mentions this code path/)).toBeInTheDocument();
  });

  it('pins a journey on double click', async () => {
    const user = userEvent.setup();
    renderTab();
    const row = await within(screen.getByTestId('panel')).findByText('cli/tasks-list');
    await user.dblClick(row);
    expect(search()).toContain('gjourney=cli%2Ftasks-list');
    expect(screen.getByLabelText('Close cli/tasks-list')).toBeInTheDocument();
  });

  // Nothing selected IS this pane — the banner over "pick a journey" — so the
  // strip never offers an Overview chip to go "back" to it.
  it('carries NO Overview entry in its tab strip', async () => {
    const user = userEvent.setup();
    renderTab();
    // Nothing selected: the surface banner and the pick-a-journey state, no strip.
    expect(await screen.findByText('Detected surfaces')).toBeInTheDocument();
    expect(screen.getByText('Select a journey')).toBeInTheDocument();
    expect(screen.queryByText('Overview')).toBeNull();

    // With a journey open the strip is up — and it holds the journey alone.
    await user.click(await within(screen.getByTestId('panel')).findByText('cli/tasks-add'));
    expect(screen.getByLabelText('Close cli/tasks-add')).toBeInTheDocument();
    expect(screen.queryByText('Overview')).toBeNull();

    // Closing it returns to the same natural state.
    await user.click(screen.getByLabelText('Close cli/tasks-add'));
    expect(await screen.findByText('Select a journey')).toBeInTheDocument();
    expect(screen.getByText('Detected surfaces')).toBeInTheDocument();
  });
});
