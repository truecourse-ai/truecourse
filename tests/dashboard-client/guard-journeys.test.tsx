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
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { GuardJourneysView } from '@truecourse/shared';
import { GuardJourneysPanel } from '@/components/guard/GuardJourneysPanel';
import { GuardJourneysPane } from '@/components/guard/GuardJourneysPane';
import { useGuardJourneys } from '@/hooks/useGuardJourneys';
import { useGuardCommandTabs, useGuardJourneyTabs } from '@/hooks/useGuardJourneyTabs';

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

/** An api repo: operation-rooted entries, one operation documented but unrouted. */
const API_MAPPED: GuardJourneysView = {
  ...MAPPED,
  journeys: [
    {
      id: 'api/get-todos-id',
      type: 'api' as const,
      title: 'GET /todos/{id}',
      entry: { method: 'GET', path: '/todos/{id}' },
      steps: [{ kind: 'request' as const, method: 'GET', path: '/todos/{id}', label: 'getTodo' }],
      fingerprint: 'sha256:get-todos-id',
      flows: [usedBy(FLOW_ID, FLOW_TITLE)],
      scenarioIds: [SCENARIO_ID],
      source: 'tree' as const,
    },
    {
      id: 'api/patch-todos-id',
      type: 'api' as const,
      title: 'PATCH /todos/{id}',
      entry: { method: 'PATCH', path: '/todos/{id}' },
      steps: [{ kind: 'request' as const, method: 'PATCH', path: '/todos/{id}' }],
      fingerprint: 'sha256:patch-todos-id',
      flows: [],
      scenarioIds: [],
      source: 'tree' as const,
      specOnly: true as const,
    },
  ],
  surfaces: SURFACES.map((s) =>
    s.surface === 'api'
      ? { ...s, journeys: 2, detected: true, source: 'tree' as const }
      : s.surface === 'cli'
        ? { ...s, journeys: 0, detected: false }
        : s,
  ),
  totals: { journeys: 2, detectedSurfaces: 1, grounded: 1, ungrounded: 1 },
};

/**
 * A journey carrying the FULL contract — a two-command tree with a shared block,
 * an `unknown` exit code, authored empty lists ("none", established) and the
 * doc-versus-code findings. The Journeys tab renders all of it.
 */
const CONTRACT: NonNullable<GuardJourneysView['journeys'][number]['contract']> = {
  summary: '`tasks add` and its `--json` mode.',
  derivedFrom: ['Source of truth: src/cli.ts', 'Cross-check: `tasks add --help` probe'],
  commands: [
    {
      path: ['tasks', 'add'],
      description: 'Add a task.',
      options: [
        { flag: '--json', takesValue: false, valueRequired: false, scope: 'command', description: 'Print JSON.' },
        {
          flag: '--priority',
          short: '-p',
          takesValue: true,
          valueRequired: true,
          valueHint: 'level',
          choices: ['low', 'high'],
          default: 'low',
          scope: 'command',
        },
        { flag: '--help', short: '-h', takesValue: false, valueRequired: false, scope: 'program' },
      ],
      positionals: [{ name: 'title', required: true, variadic: false, description: 'The task title.' }],
      io: {
        consumes: {
          stdin: [{ name: 'first-run wizard', when: 'no config saved', prompts: ['Where should tasks live?'] }],
          reads: [{ path: '~/.tasks.json', as: 'the task store' }],
          environment: ['TASKS_HOME — relocates the store'],
        },
        produces: {
          stdout: [{ shape: 'created line', when: 'always', content: 'Created task <id>' }],
          stderr: [],
          writes: [{ path: '~/.tasks.json', when: 'always' }],
          exitCodes: [
            { code: '0', means: 'task created' },
            { code: 'unknown', means: 'an unwritable store declares no exit path in code' },
          ],
          sideEffects: [],
        },
      },
      notes: ['Re-running with the same title creates a second task.'],
      inheritsShared: [{ block: 'stdin', note: 'the first-run wizard' }],
    },
    {
      path: ['tasks', 'purge'],
      description: 'Delete every completed task.',
      options: [{ flag: '--force', takesValue: false, valueRequired: false, scope: 'command' }],
      positionals: [],
    },
  ],
  shared: {
    note: 'Facts every command in the tree carries.',
    notes: ['Every command resolves the store by walking up from the cwd.'],
  },
  decisions: [
    {
      id: 'no-remote-store',
      decision: 'The contract models the local store only.',
      consequencesNotModeled: ['the remote-sync exit path'],
    },
  ],
};

const DIAGNOSTICS: NonNullable<GuardJourneysView['journeys'][number]['diagnostics']> = [
  { kind: 'docs-missing-behavior', subject: '--priority', detail: 'The docs omit the default.', right: 'code' },
  { kind: 'grammar-agreement', subject: 'add flag set', detail: 'Docs and code list the same flags.', right: 'both agree' },
];

const WITH_CONTRACT: GuardJourneysView = {
  ...MAPPED,
  journeys: [
    { ...MAPPED.journeys[0], contract: CONTRACT, diagnostics: DIAGNOSTICS },
    // The shape the mapper writes today: the command tree, no contract at all.
    MAPPED.journeys[1],
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
  const commandTabs = useGuardCommandTabs('r');
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
        commandTabs={commandTabs}
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
  const commandTabs = useGuardCommandTabs('r');
  const loc = useLocation();
  return (
    <>
      <span data-testid="search">{loc.search}</span>
      <GuardJourneysPane
        view={view}
        loading={false}
        error={null}
        mapping={false}
        onMap={() => {}}
        tabs={tabs}
        commandTabs={commandTabs}
        onOpenFlow={() => {}}
      />
    </>
  );
}

const renderPane = (view: GuardJourneysView, url = '/repos/r?tab=journeys') =>
  render(
    <MemoryRouter initialEntries={[url]}>
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

  it('labels an api journey by its operation and says when the operation is documented but unrouted', async () => {
    renderPane(API_MAPPED, '/repos/r?tab=journeys&gjourney=api%2Fpatch-todos-id');

    expect(await screen.findByText(/entry PATCH \/todos\/\{id\}/)).toBeInTheDocument();
    // The specOnly cross-check reads as a plain sentence, and the zero-references
    // line must NOT claim the spec never mentions it — the spec is where it's from.
    expect(screen.getByText(/no code route serves it/)).toBeInTheDocument();
    expect(screen.getByText('No flow uses this journey yet.')).toBeInTheDocument();
    expect(screen.queryByText(/the spec never mentions this code path/)).not.toBeInTheDocument();
  });

  it('an api journey that code serves carries no unrouted caution', async () => {
    renderPane(API_MAPPED, '/repos/r?tab=journeys&gjourney=api%2Fget-todos-id');

    expect(await screen.findByText(/entry GET \/todos\/\{id\}/)).toBeInTheDocument();
    expect(screen.queryByText(/no code route serves it/)).not.toBeInTheDocument();
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
    // The scroll is a passive effect on the commit that renders the rows, so the
    // list being queryable does NOT mean it has run yet — poll for the effect
    // rather than the DOM it fires alongside.
    await waitFor(() =>
      expect(scrolled.some((el) => el.textContent?.includes('cli/tasks-done'))).toBe(true),
    );
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

  // The contract is rendered by the pane, not fetched separately — see the
  // dedicated describe below for the grammar table and the io panel.

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

/**
 * The CONTRACT block: the grammar of every command in the tree, each command's
 * input/output, the authored decisions and the doc-versus-code findings. The two
 * honesty rules are asserted directly — `unknown` reads as unknown, and a list
 * the derivation never established renders nothing rather than a confident
 * "none".
 */
describe('Journeys tab — the contract', () => {
  const openAdd = () => renderPane(WITH_CONTRACT, '/repos/r?tab=journeys&gjourney=cli%2Ftasks-add');

  /** The panel a block lives in — `--priority` is a grammar row AND a finding's subject. */
  const panel = (heading: string) => within(screen.getByText(heading).parentElement as HTMLElement);

  it('renders the grammar as a table: requiredness, value, choices, default, scope', async () => {
    openAdd();
    expect(await screen.findByText('Grammar')).toBeInTheDocument();
    const grammar = within(screen.getAllByRole('table')[0]);

    const priority = grammar.getByText('--priority').closest('tr')!;
    expect(within(priority).getByText(', -p')).toBeInTheDocument();
    expect(within(priority).getByText('required <level>')).toBeInTheDocument();
    expect(within(priority).getByText('low | high')).toBeInTheDocument();
    expect(within(priority).getByText('low')).toBeInTheDocument();

    // A flag that takes nothing says so, rather than leaving the column blank.
    const json = grammar.getByText('--json').closest('tr')!;
    expect(within(json).getByText('no value')).toBeInTheDocument();
    expect(within(json).getByText('Print JSON.')).toBeInTheDocument();

    // A program-level flag is chipped — it is passed BEFORE the subcommand.
    const help = grammar.getByText('--help').closest('tr')!;
    expect(within(help).getByText('program')).toBeInTheDocument();
  });

  it('renders the positional arguments with their requiredness', async () => {
    openAdd();
    expect(await screen.findByText('Positional arguments')).toBeInTheDocument();
    const title = within(screen.getAllByRole('table')[1]).getByText('title').closest('tr')!;
    expect(within(title).getByText('required')).toBeInTheDocument();
    expect(within(title).getByText('The task title.')).toBeInTheDocument();
  });

  it('renders the input/output contract — prompts, reads, writes, exit codes', async () => {
    openAdd();
    expect(await screen.findByText('Input and output')).toBeInTheDocument();
    const consumes = panel('Consumes');
    const produces = panel('Produces');

    // The prompt and the question it asks, verbatim.
    expect(consumes.getByText('first-run wizard')).toBeInTheDocument();
    expect(consumes.getByText('“Where should tasks live?”')).toBeInTheDocument();
    expect(consumes.getByText('~/.tasks.json')).toBeInTheDocument();
    expect(consumes.getByText(/TASKS_HOME/)).toBeInTheDocument();
    expect(produces.getByText('created line')).toBeInTheDocument();
    expect(produces.getByText('~/.tasks.json')).toBeInTheDocument();

    // Exit codes with their meanings — and `unknown` shown AS unknown.
    expect(produces.getByText('0')).toBeInTheDocument();
    expect(produces.getByText('unknown')).toBeInTheDocument();
    expect(produces.getByText('an unwritable store declares no exit path in code')).toBeInTheDocument();

    // An authored EMPTY list is a fact: under its own heading it reads "none",
    // it is never hidden and never confused with a heading that was left off.
    const block = (heading: string) =>
      within(produces.getByText(heading).parentElement as HTMLElement);
    expect(block('Stderr').getByText('none')).toBeInTheDocument();
    expect(block('Side effects').getByText('none')).toBeInTheDocument();

    // A fact this command inherits from the tree points at the shared block.
    expect(screen.getByText(/\+ shared stdin/)).toBeInTheDocument();
    expect(screen.getByText('Shared across every command')).toBeInTheDocument();
  });

  it('renders the authored decisions and the doc-versus-code findings', async () => {
    openAdd();
    expect(await screen.findByText('Authored decisions')).toBeInTheDocument();
    expect(screen.getByText('no-remote-store')).toBeInTheDocument();
    expect(screen.getByText('the remote-sync exit path')).toBeInTheDocument();

    expect(screen.getByText('Doc-versus-code findings')).toBeInTheDocument();
    expect(screen.getByText('docs-missing-behavior')).toBeInTheDocument();
    expect(screen.getByText('The docs omit the default.')).toBeInTheDocument();
    // An AGREEMENT is a result too — the feed shows it, it does not hide it.
    expect(screen.getByText('grammar-agreement')).toBeInTheDocument();
    expect(screen.getByText(/both agree/)).toBeInTheDocument();
  });

  it('previews a command on single click and pins it on double click — the same tab model as the journey rows', async () => {
    const user = userEvent.setup();
    openAdd();

    const commands = await screen.findByRole('list', { name: 'Commands' });
    // The first command is the one on screen until another is picked.
    expect(screen.getByText('Add a task.')).toBeInTheDocument();

    // Single click previews — and, like every guard selection, it is addressable.
    await user.click(within(commands).getByText('tasks purge'));
    expect(screen.getByText('Delete every completed task.')).toBeInTheDocument();
    expect(screen.queryByText('Add a task.')).not.toBeInTheDocument();
    expect(search()).toContain('gcmd=tasks+purge');
    expect(screen.queryByLabelText('tasks purge pinned')).not.toBeInTheDocument();

    // Double click pins it — the row says so, and the URL still names it.
    await user.dblClick(within(commands).getByText('tasks purge'));
    expect(screen.getByLabelText('tasks purge pinned')).toBeInTheDocument();
    expect(search()).toContain('gcmd=tasks+purge');
  });

  it('opens on the pinned command from a deep link', async () => {
    renderPane(WITH_CONTRACT, '/repos/r?tab=journeys&gjourney=cli%2Ftasks-add&gcmd=tasks+purge');
    expect(await screen.findByText('Delete every completed task.')).toBeInTheDocument();
    // `tasks purge` declares no positionals at all — established as none.
    const positionals = screen.getByText('Positional arguments').parentElement as HTMLElement;
    expect(within(positionals).getByText('none')).toBeInTheDocument();
  });

  it('says so plainly when the catalog carries no contract — nothing is filled in', async () => {
    renderPane(WITH_CONTRACT, '/repos/r?tab=journeys&gjourney=cli%2Ftasks-list');
    expect(await screen.findByText('No contract derived')).toBeInTheDocument();
    expect(screen.getByText(/nothing is filled in on their behalf/)).toBeInTheDocument();
    expect(screen.queryByText('Grammar')).not.toBeInTheDocument();
    expect(screen.queryByText('Doc-versus-code findings')).not.toBeInTheDocument();
  });
});
