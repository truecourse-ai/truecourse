/**
 * Guard INTERFACES-tab tests — the code half's read surface and its one FREE action.
 * Covers the unmapped empty state and the Map swap (the POST answers with the
 * fresh catalog, so the tab re-renders from the response — no refetch, no socket),
 * the per-surface catalog with the reverse index onto the flows, the SURFACE
 * FILTER over it, the per-surface FAMILIES the catalog groups its entries into,
 * the per-surface RECIPE rows the panel opens with (the preparation THAT surface
 * runs on, in its two readings, in one field grammar for every surface), the
 * sequence diagram, and the "Used by flows" click-through into the Flows tab.
 *
 * There is no detected-surface banner: the surface groups of the catalog beside
 * the pane ARE that information, and saying it twice is two things to keep in
 * agreement.
 *
 * Fixture: the plan's taskbird cli catalog — three grounded interfaces plus one no
 * flow mentions (the candidate spec gap).
 */

import { useState } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { GuardDriverId, GuardInterfacesView, GuardRecipeCard } from '@truecourse/shared';
import { GuardInterfacesPanel } from '@/components/guard/GuardInterfacesPanel';
import { GuardInterfacesPane } from '@/components/guard/GuardInterfacesPane';
import { useGuardInterfaces } from '@/hooks/useGuardInterfaces';
import { useGuardCommandTabs, useGuardInterfaceTabs } from '@/hooks/useGuardInterfaceTabs';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

const FLOW_ID = 'task-lifecycle';
const SCENARIO_ID = 'task-lifecycle.cli.1';

/** The web surface's preparation — one server, two readers (see {@link RECIPE}). */
const WEB_SURFACE = {
  build: 'pnpm build:web',
  serve: ['node', 'dist/web.js'],
  healthPath: '/health',
  readyTimeoutMs: 60000,
};

/**
 * The recipe the surface rows open, as the wire hands it over: preparation PER
 * SURFACE, every surface in the same shape. This is the reference repo's own
 * shape — a `web` block and no `api` block — so the api surface carries the web
 * block's server, marked as shared, because that is the one surface the runner
 * serves for both web steps and `request` steps.
 */
const RECIPE: GuardRecipeCard = {
  surfaces: {
    cli: {
      install: 'pnpm install --frozen-lockfile',
      build: 'pnpm build',
      entry: ['node', 'dist/tasks.js'],
      env: { TASKS_HOME: '.tmp/tasks' },
    },
    api: { ...WEB_SURFACE, sharedWithWeb: true },
    web: WEB_SURFACE,
  },
  fingerprint: 'sha256:9f2caabbccdd',
  stale: false,
};

/** A repo that DOES declare an api block: the api surface is its own server. */
const API_RECIPE: GuardRecipeCard = {
  ...RECIPE,
  surfaces: {
    cli: RECIPE.surfaces.cli!,
    api: {
      serve: ['node', 'dist/server.js'],
      services: { up: 'docker compose up -d --wait', down: 'docker compose down' },
    },
    web: WEB_SURFACE,
  },
};

/** A repo that serves nothing at all — the api surface has no preparation. */
const CLI_ONLY_RECIPE: GuardRecipeCard = {
  ...RECIPE,
  surfaces: { cli: RECIPE.surfaces.cli! },
};

/**
 * What the raw route answers — the stored file, WHOLE, whatever surface asked for
 * it, with its inline credential already masked (the masking is the server's, and
 * is pinned there).
 */
const RECIPE_RAW = JSON.stringify(
  {
    install: 'pnpm install --frozen-lockfile',
    build: 'pnpm build',
    entry: ['node', 'dist/tasks.js'],
    web: { serve: ['node', 'dist/web.js'] },
    api: { credentials: { 'api-key': { header: 'Authorization', value: '•••••••••••• (inline value, masked)' } } },
  },
  null,
  2,
);

/** Every `/guard/recipe/raw` URL asked for — the raw mode must be LAZY. */
let recipeRawRequests: string[] = [];

/** The wire always carries a row per registry driver — the catalog groups the ones with code. */
const SURFACES: GuardInterfacesView['surfaces'] = [
  { surface: 'cli', label: 'CLI', runnable: true, interfaces: 5, detected: true, source: 'tree' },
  { surface: 'api', label: 'API', runnable: true, interfaces: 0, detected: false },
  { surface: 'web', label: 'Web', runnable: false, waitingLabel: 'Needs web driver', interfaces: 0, detected: false },
  { surface: 'desktop', label: 'Desktop', runnable: false, waitingLabel: 'Needs desktop driver', interfaces: 0, detected: false },
];

const FLOW_TITLE = 'A user creates a task, sees it listed, and completes it';
const BLOCKED_FLOW_ID = 'manage-telemetry-settings';

/** A realized usage — a committed scenario grounds on the interface. */
const usedBy = (flowId: string, title: string) => ({ flowId, title, realized: true });

const iface = (
  slug: string,
  title: string,
  flags: string[],
  flows: GuardInterfacesView['interfaces'][number]['flows'],
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

const MAPPED: GuardInterfacesView = {
  mapped: true,
  generatedAt: '2026-07-24T13:39:00.000Z',
  recipeFingerprint: 'sha256:r',
  interfaces: [
    iface('tasks-add', 'tasks add', ['--json'], [usedBy(FLOW_ID, FLOW_TITLE)]),
    iface('tasks-list', 'tasks list', ['--done'], [usedBy(FLOW_ID, FLOW_TITLE)]),
    iface('tasks-done', 'tasks done', [], [usedBy(FLOW_ID, FLOW_TITLE)]),
    iface('tasks-purge', 'tasks purge', ['--force'], []),
    // Matched by a flow whose authoring was refused — used, never exercised.
    iface('telemetry', 'tasks telemetry', [], [
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
  totals: { interfaces: 5, detectedSurfaces: 1, grounded: 4, ungrounded: 1 },
};

/** A repo with two surfaces found — one runnable today, one still awaiting its driver. */
const CLI_AND_WEB: GuardInterfacesView = {
  ...MAPPED,
  interfaces: [
    ...MAPPED.interfaces,
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
    s.surface === 'web' ? { ...s, interfaces: 1, detected: true, source: 'probes' as const } : s,
  ),
  totals: { interfaces: 6, detectedSurfaces: 2, grounded: 4, ungrounded: 2 },
};

/**
 * A catalog whose entries carry the FAMILY the derivation put them in: two cli
 * trees, one entry in no family at all (`version`), and — on the web surface — a
 * family that happens to share the `rules` name and means its own thing.
 */
const FAMILIES: GuardInterfacesView = {
  ...MAPPED,
  interfaces: [
    iface('version', 'version', [], []),
    { ...iface('rules-list', 'rules list', [], []), group: 'rules' },
    { ...iface('analyses-list', 'analyses list', [], []), group: 'analyses' },
    { ...iface('rules-disable', 'rules disable', [], []), group: 'rules' },
    {
      id: 'web/rules-page',
      type: 'web',
      title: 'Rules page',
      group: 'rules',
      entry: { command: ['web'] },
      steps: [{ kind: 'navigate', route: '/rules' }],
      fingerprint: 'sha256:web-rules-page',
      flows: [],
      scenarioIds: [],
      source: 'probes',
    },
  ],
  surfaces: CLI_AND_WEB.surfaces,
  totals: { interfaces: 5, detectedSurfaces: 2, grounded: 0, ungrounded: 5 },
};

/**
 * The 2026-07-27 report: an interface grounded by a test whose flow the corpus
 * can't name rendered the raw TEST ID as loose text beside real chips.
 */
const ORPHAN_TEST_ID = 'run-the-community-edition-without-the-ee-directory.cli.1';
const MIXED_REFS: GuardInterfacesView = {
  ...MAPPED,
  interfaces: [
    {
      ...MAPPED.interfaces[0],
      id: 'cli/tasks-add',
      flows: [usedBy(FLOW_ID, FLOW_TITLE)],
      scenarioIds: [SCENARIO_ID, ORPHAN_TEST_ID],
    },
  ],
};

/** An api repo: operation-rooted entries, one operation documented but unrouted. */
const API_MAPPED: GuardInterfacesView = {
  ...MAPPED,
  interfaces: [
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
      ? { ...s, interfaces: 2, detected: true, source: 'tree' as const }
      : s.surface === 'cli'
        ? { ...s, interfaces: 0, detected: false }
        : s,
  ),
  totals: { interfaces: 2, detectedSurfaces: 1, grounded: 1, ungrounded: 1 },
};

/**
 * A catalog with ALL THREE runnable surfaces in it — one group each, and so one
 * recipe row each. The case that proves no surface is quietly left without one.
 */
const ALL_SURFACES: GuardInterfacesView = {
  ...MAPPED,
  interfaces: [
    MAPPED.interfaces[0],
    API_MAPPED.interfaces[0],
    CLI_AND_WEB.interfaces[CLI_AND_WEB.interfaces.length - 1],
  ],
  surfaces: SURFACES.map((s) =>
    s.surface === 'cli' || s.surface === 'api' || s.surface === 'web'
      ? { ...s, interfaces: 1, detected: true, source: 'tree' as const }
      : s,
  ),
  totals: { interfaces: 3, detectedSurfaces: 3, grounded: 2, ungrounded: 1 },
};

/**
 * An interface carrying the FULL contract — a two-command tree, io as structured
 * FACTS (markers, exit statuses, writes, prompts, env reads), an `unknown` exit
 * status and an authored empty list ("none", established). There is no prose
 * anywhere in it: the tab renders the CALLING INTERFACE and nothing else.
 */
const CONTRACT: NonNullable<GuardInterfacesView['interfaces'][number]['contract']> = {
  summary: '`tasks add` and its `--json` mode.',
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
          prompts: [
            {
              kind: 'select',
              marker: 'Where should tasks live?',
              answerHint: 'home | here',
              submit: 'enter',
              when: 'no config saved',
            },
            { kind: 'confirm', marker: 'Overwrite it?', submit: 'char' },
            // Nobody established how this one is submitted — it says nothing.
            { kind: 'text', marker: 'Name it?' },
          ],
          env: [{ var: 'TASKS_HOME', when: 'relocating the store' }],
        },
        produces: {
          output: [
            { stream: 'stdout', marker: 'Created task ' },
            { stream: 'stderr', marker: 'store is read-only', when: 'the store cannot be written' },
          ],
          rows: [
            {
              role: 'header',
              stream: 'stdout',
              template: 'Tasks for <list>: <shown> shown (<done> done)',
              slots: [
                { name: 'list', kind: 'text' },
                { name: 'shown', kind: 'count' },
                { name: 'done', kind: 'count' },
              ],
            },
            {
              role: 'row',
              stream: 'stdout',
              template: '<state>  <title>',
              slots: [
                { name: 'state', kind: 'enum', values: ['todo', 'done'] },
                { name: 'title', kind: 'text' },
              ],
              when: 'one line per task',
            },
          ],
          exits: [
            { exit: '0', when: 'the task was created' },
            { exit: 'unknown', when: 'an unwritable store declares no exit path in code' },
          ],
          writes: [],
        },
      },
    },
    {
      // Carries no io at all — there is no panel to fill for it.
      path: ['tasks', 'purge'],
      description: 'Delete every completed task.',
      options: [{ flag: '--force', takesValue: false, valueRequired: false, scope: 'command' }],
      positionals: [],
    },
  ],
};

/**
 * The same contract with the READ side established: facts on the command that
 * reads them, and an authored EMPTY list on the one that reads nothing. Kept apart
 * from {@link CONTRACT} so the unestablished case (no `reads` key at all) still has
 * a fixture of its own — the two absences must never collapse into one rendering.
 */
const WITH_READS: GuardInterfacesView = {
  ...MAPPED,
  interfaces: [
    {
      ...MAPPED.interfaces[0],
      contract: {
        ...CONTRACT,
        commands: [
          {
            ...CONTRACT.commands[0],
            io: {
              ...CONTRACT.commands[0].io,
              consumes: {
                ...CONTRACT.commands[0].io!.consumes,
                reads: [
                  { path: '~/.tasks.json', when: 'the store the listing renders' },
                  { path: '<repo>/.tasks/config.json' },
                ],
              },
            },
          },
          { ...CONTRACT.commands[1], io: { consumes: { reads: [] } } },
        ],
      },
    },
    MAPPED.interfaces[1],
  ],
};

const WITH_CONTRACT: GuardInterfacesView = {
  ...MAPPED,
  interfaces: [
    { ...MAPPED.interfaces[0], contract: CONTRACT },
    // The shape the mapper writes today: the command tree, no contract at all.
    MAPPED.interfaces[1],
  ],
};

const UNMAPPED: GuardInterfacesView = {
  mapped: false,
  generatedAt: null,
  recipeFingerprint: null,
  interfaces: [],
  surfaces: SURFACES.map((s) => ({ ...s, interfaces: 0, detected: false })),
  totals: { interfaces: 0, detectedSurfaces: 0, grounded: 0, ungrounded: 0 },
};

afterEach(() => vi.unstubAllGlobals());

/**
 * The tab exactly as RepoPage wires it: one hook feeding panel + pane, the surface
 * narrowing and the per-surface RECIPE toggle owned above both (the opener is in
 * the panel, the body is in the pane).
 */
function InterfacesHarness({
  onOpenFlow = () => {},
  recipe = RECIPE,
}: {
  onOpenFlow?: (flowId: string) => void;
  /** The recipe each surface group's opener shows; null hides the openers. */
  recipe?: GuardRecipeCard | null;
}) {
  const interfaces = useGuardInterfaces('r', true);
  const tabs = useGuardInterfaceTabs('r');
  const commandTabs = useGuardCommandTabs('r');
  const loc = useLocation();
  const [surfaces, setSurfaces] = useState<string[]>([]);
  const [recipeSurface, setRecipeSurface] = useState<GuardDriverId | null>(null);
  return (
    <div>
      <span data-testid="search">{loc.search}</span>
      <div data-testid="panel">
        <GuardInterfacesPanel
          interfaces={interfaces.view?.interfaces ?? []}
          loading={interfaces.loading}
          error={interfaces.error}
          activeId={recipeSurface ? null : tabs.activeId}
          surfaces={surfaces}
          onSurfaces={setSurfaces}
          hasRecipe={recipe != null}
          recipeSurface={recipeSurface}
          onToggleRecipe={(surface) => setRecipeSurface((open) => (open === surface ? null : surface))}
          onOpen={(id, pinned) => {
            setRecipeSurface(null);
            tabs.open(id, pinned);
          }}
        />
      </div>
      <GuardInterfacesPane repoId="r"
        view={interfaces.view}
        loading={interfaces.loading}
        error={interfaces.error}
        tabs={tabs}
        commandTabs={commandTabs}
        recipe={recipe}
        recipeSurface={recipeSurface}
        onCloseRecipe={() => setRecipeSurface(null)}
        onOpenFlow={onOpenFlow}
      />
    </div>
  );
}

const renderTab = (
  url = '/repos/r?tab=interfaces',
  onOpenFlow?: (flowId: string) => void,
  props: { recipe?: GuardRecipeCard | null } = {},
) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <InterfacesHarness onOpenFlow={onOpenFlow} {...props} />
    </MemoryRouter>,
  );

/** The pane alone on a fixed view — for states the fetch fixtures don't carry. */
function PaneHarness({ view }: { view: GuardInterfacesView }) {
  const tabs = useGuardInterfaceTabs('r');
  const commandTabs = useGuardCommandTabs('r');
  const loc = useLocation();
  return (
    <>
      <span data-testid="search">{loc.search}</span>
      <GuardInterfacesPane repoId="r"
        view={view}
        loading={false}
        error={null}
        tabs={tabs}
        commandTabs={commandTabs}
        onOpenFlow={() => {}}
      />
    </>
  );
}

const renderPane = (view: GuardInterfacesView, url = '/repos/r?tab=interfaces') =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <PaneHarness view={view} />
    </MemoryRouter>,
  );

const search = () => screen.getByTestId('search').textContent ?? '';

/**
 * The catalog panel in render order: every group header as `# label`, interleaved
 * with the row ids between them — the one reading that shows WHAT nests under WHAT.
 */
const catalogOutline = () =>
  Array.from(
    screen
      .getByRole('list', { name: 'Interface catalog' })
      .querySelectorAll<HTMLElement>('.sticky, [role="listitem"]'),
  ).map((el) => {
    const text = el.querySelector('span')?.textContent ?? '';
    return el.getAttribute('role') === 'listitem' ? text : `# ${text}`;
  });

describe('Interfaces tab — the surfaces are the catalog’s, not a banner’s', () => {
  it('carries no detected-surface banner at all — the surface groups are that reading', () => {
    renderPane(CLI_AND_WEB);
    expect(screen.queryByText('Detected surfaces')).not.toBeInTheDocument();
    expect(screen.queryByText(/CLI · runnable ✓/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Web · Needs web driver ⚠/)).not.toBeInTheDocument();
  });

  it('names the surfaces and nothing else — how a catalog was derived is store data', () => {
    renderPane(CLI_AND_WEB, '/repos/r?tab=interfaces&ginterface=web%2Ftasks-board');
    // `tree` / `probes` is a degradation marker the store keeps; no reading of the
    // page — the open interface's byline included — says it.
    expect(screen.queryByText(/\btree\b|\bprobes\b/)).not.toBeInTheDocument();
  });

  it('says what an empty catalog means — and offers no action for it', () => {
    renderPane(UNMAPPED);
    expect(screen.getByText('No interfaces mapped yet')).toBeInTheDocument();
    // The Map trigger is gone: interface derivation is the engine's, not a button.
    expect(screen.queryByText(/free, no LLM/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Map/ })).toBeNull();
  });
});

describe('Interfaces tab — the mapped catalog', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => (String(url).includes('/guard/interfaces') ? json(MAPPED) : json({}))),
    );
  });

  it('groups the catalog by surface and carries the reverse index onto the flows', async () => {
    renderTab();
    const list = await screen.findByRole('list', { name: 'Interface catalog' });
    expect(within(list).getByText('CLI')).toBeInTheDocument();
    // Four interfaces are used by one flow each — the three realized ones AND the
    // one whose flow matched but was blocked before a scenario could be written.
    expect(within(list).getAllByText('1 flow')).toHaveLength(4);
    // Nothing references `tasks purge` — the candidate spec gap.
    expect(within(list).getByText('0 flows')).toBeInTheDocument();
  });

  it('previews an interface as a sequence diagram and links the flows that use it', async () => {
    const user = userEvent.setup();
    const onOpenFlow = vi.fn();
    renderTab('/repos/r?tab=interfaces', onOpenFlow);
    await user.click(await within(screen.getByTestId('panel')).findByText('cli/tasks-add'));
    expect(search()).toContain('ginterface=cli%2Ftasks-add');

    const diagram = await screen.findByRole('group', { name: 'Interface cli/tasks-add' });
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

  it('an interface used only by a BLOCKED flow reads as used, and says what it needs', async () => {
    const user = userEvent.setup();
    const onOpenFlow = vi.fn();
    renderTab('/repos/r?tab=interfaces&ginterface=cli%2Ftelemetry', onOpenFlow);

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

  // An interface's truth is its entry in guard/interfaces.json, so the detail offers
  // the SAME two readings every artifact-backed entity does — and no third.
  it('switches between the page and the stored interface entry, defaulting to the page', async () => {
    const user = userEvent.setup();
    const RAW = JSON.stringify({ id: 'cli/tasks-add', type: 'cli', fingerprint: 'sha256:j1' }, null, 2);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/interface/raw')) return json({ id: 'cli/tasks-add', file: 'f.json', content: RAW });
        return u.includes('/guard/interfaces') ? json(MAPPED) : json({});
      }),
    );
    renderTab('/repos/r?tab=interfaces&ginterface=cli%2Ftasks-add');
    await screen.findByRole('group', { name: 'Interface cli/tasks-add' });

    const modes = screen.getByRole('group', { name: 'View mode' });
    expect(within(modes).getAllByRole('button').map((b) => b.textContent)).toEqual(['View', 'JSON']);
    expect(within(modes).getByRole('button', { name: 'View' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('interface source')).not.toBeInTheDocument();

    await user.click(within(modes).getByRole('button', { name: 'JSON' }));
    await waitFor(() => expect(screen.getByLabelText('interface source')).toHaveTextContent('sha256:j1'));
    // The stored file REPLACES the page — never two readings at once.
    expect(screen.queryByRole('group', { name: 'Interface cli/tasks-add' })).not.toBeInTheDocument();
    expect(screen.queryByText('Used by flows')).not.toBeInTheDocument();

    await user.click(within(modes).getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('group', { name: 'Interface cli/tasks-add' })).toBeInTheDocument();
  });

  it('labels an api interface by its operation and says when the operation is documented but unrouted', async () => {
    renderPane(API_MAPPED, '/repos/r?tab=interfaces&ginterface=api%2Fpatch-todos-id');

    expect(await screen.findByText(/entry PATCH \/todos\/\{id\}/)).toBeInTheDocument();
    // The specOnly cross-check reads as a plain sentence, and the zero-references
    // line must NOT claim the spec never mentions it — the spec is where it's from.
    expect(screen.getByText(/no code route serves it/)).toBeInTheDocument();
    expect(screen.getByText('No flow uses this interface yet.')).toBeInTheDocument();
    expect(screen.queryByText(/the spec never mentions this code path/)).not.toBeInTheDocument();
  });

  it('an api interface that code serves carries no unrouted caution', async () => {
    renderPane(API_MAPPED, '/repos/r?tab=interfaces&ginterface=api%2Fget-todos-id');

    expect(await screen.findByText(/entry GET \/todos\/\{id\}/)).toBeInTheDocument();
    expect(screen.queryByText(/no code route serves it/)).not.toBeInTheDocument();
  });

  it('renders EVERY reference as the same chip — an unnameable flow chips its id', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) =>
        String(url).includes('/guard/interfaces') ? json(MIXED_REFS) : json({}),
      ),
    );
    renderTab('/repos/r?tab=interfaces&ginterface=cli%2Ftasks-add');
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

  it('scrolls a deep-linked interface row into view — the cross-navigation rule', async () => {
    const scrolled: Element[] = [];
    const spy = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(function (this: Element) {
        scrolled.push(this);
      });
    renderTab('/repos/r?tab=interfaces&ginterface=cli%2Ftasks-done');
    await screen.findByRole('list', { name: 'Interface catalog' });
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
    const list = await screen.findByRole('list', { name: 'Interface catalog' });
    // The list itself scrolls — DOWN only, x clipped — and nothing between it and
    // the panel root does.
    expect(list.className).toMatch(/overflow-y-auto/);
    expect(list.className).toMatch(/overflow-x-hidden/);
    for (let el = list.parentElement; el; el = el.parentElement) {
      if (el.tagName === 'BODY') break;
      expect(el.className).not.toMatch(/overflow-(auto|scroll|y-auto|y-scroll)/);
    }
    // …and no inner overflow box under it either (the double-scrollbar report).
    // Read through the attribute: an SVG child (an affordance row's icon) has an
    // SVGAnimatedString for `className`, not a string.
    for (const child of Array.from(list.querySelectorAll<HTMLElement>('*'))) {
      expect(child.getAttribute('class') ?? '').not.toMatch(/overflow-(auto|scroll|y-auto|y-scroll)/);
    }
  });

  it('a ?ginterface deep link opens the interface, and one NO flow references says so', async () => {
    renderTab('/repos/r?tab=interfaces&ginterface=cli%2Ftasks-purge');
    expect(await screen.findByRole('group', { name: 'Interface cli/tasks-purge' })).toBeInTheDocument();
    // Reserved for zero references of any kind — realized or merely planned.
    expect(screen.getAllByText(/No flow uses this interface/).length).toBeGreaterThan(0);
    expect(screen.getByText(/the spec never mentions this code path/)).toBeInTheDocument();
  });

  it('a retired ?gjourney deep link still opens the interface, and a click converges the URL', async () => {
    // The param was `?gjourney=` before the INTERFACE rename (2026-08-10). It is
    // READ as an alias so bookmarks survive, and the first write drops it — the
    // URL never carries both spellings.
    const user = userEvent.setup();
    renderTab('/repos/r?tab=interfaces&gjourney=cli%2Ftasks-purge');
    expect(await screen.findByRole('group', { name: 'Interface cli/tasks-purge' })).toBeInTheDocument();
    await user.click(await within(screen.getByTestId('panel')).findByText('cli/tasks-list'));
    expect(search()).toContain('ginterface=cli%2Ftasks-list');
    expect(search()).not.toContain('gjourney');
  });

  it('pins an interface on double click', async () => {
    const user = userEvent.setup();
    renderTab();
    const row = await within(screen.getByTestId('panel')).findByText('cli/tasks-list');
    await user.dblClick(row);
    expect(search()).toContain('ginterface=cli%2Ftasks-list');
    expect(screen.getByLabelText('Close cli/tasks-list')).toBeInTheDocument();
  });

  // The contract is rendered by the pane, not fetched separately — see the
  // dedicated describe below for the grammar table and the io panel.

  // Nothing selected IS this pane — "pick an interface" — so the strip never
  // offers an Overview chip to go "back" to it.
  it('carries NO Overview entry in its tab strip', async () => {
    const user = userEvent.setup();
    renderTab();
    // Nothing selected: the pick-an-interface state, no strip.
    expect(await screen.findByText('Select an interface')).toBeInTheDocument();
    expect(screen.queryByText('Overview')).toBeNull();

    // With an interface open the strip is up — and it holds the interface alone.
    await user.click(await within(screen.getByTestId('panel')).findByText('cli/tasks-add'));
    expect(screen.getByLabelText('Close cli/tasks-add')).toBeInTheDocument();
    expect(screen.queryByText('Overview')).toBeNull();

    // Closing it returns to the same natural state.
    await user.click(screen.getByLabelText('Close cli/tasks-add'));
    expect(await screen.findByText('Select an interface')).toBeInTheDocument();
  });
});

/**
 * The SURFACE FILTER — the one filter idiom over the catalog: a count chip per
 * surface the catalog has, counted by the very predicate that narrows it. The
 * surface GROUPS survive the narrowing; filtering to one surface just leaves that
 * surface's groups standing.
 */
describe('Interfaces tab — the surface filter', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => (String(url).includes('/guard/interfaces') ? json(FAMILIES) : json({}))),
    );
  });

  const bar = () => screen.getByRole('group', { name: 'Filter by surface' });

  it('offers a chip per surface the catalog HAS, counted by what it keeps', async () => {
    renderTab();
    await within(screen.getByTestId('panel')).findByText('cli/version');
    // FAMILIES: four cli entries, one web entry.
    expect(within(bar()).getByRole('button', { name: 'CLI 4' })).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: 'Web 1' })).toBeInTheDocument();
    // Drivers with no code behind them are engine knowledge, not user information.
    expect(within(bar()).queryByRole('button', { name: /^API/ })).toBeNull();
    expect(within(bar()).queryByRole('button', { name: /^Desktop/ })).toBeNull();
  });

  it('narrows to the surface clicked — its groups stay, the others go', async () => {
    const user = userEvent.setup();
    renderTab();
    await within(screen.getByTestId('panel')).findByText('cli/version');

    await user.click(within(bar()).getByRole('button', { name: 'Web 1' }));
    // Just the web surface — its recipe row, then its own family header under it.
    expect(catalogOutline()).toEqual(['Web recipe', '# Web', '# rules', 'web/rules-page']);
    expect(within(bar()).getByRole('button', { name: 'Web 1' })).toHaveAttribute('aria-pressed', 'true');

    // The chip's count never promised more than the list shows.
    await user.click(within(bar()).getByRole('button', { name: 'CLI 4' }));
    expect(
      catalogOutline().filter((line) => !line.startsWith('#') && !line.endsWith(' recipe')),
    ).toHaveLength(4);

    // Toggle-off restores the whole catalog.
    await user.click(within(bar()).getByRole('button', { name: 'CLI 4' }));
    expect(catalogOutline()).toContain('# Web');
    expect(catalogOutline()).toContain('# CLI');
  });
});

/**
 * THE RECIPE, where preparation belongs: on the SURFACE it prepares. The panel
 * opens with one row per surface the catalog shows — real list rows, not buttons
 * floating over the list — and the pane shows that surface's fields, never
 * another surface's. The raw reading stays the whole file.
 */
describe('Interfaces tab — the per-surface recipe', () => {
  beforeEach(() => {
    recipeRawRequests = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        const u = String(url);
        if (u.includes('/guard/recipe/raw')) {
          recipeRawRequests.push(u);
          return json({ file: '.truecourse/scenarios/recipe.json', content: RECIPE_RAW });
        }
        return u.includes('/guard/interfaces') ? json(CLI_AND_WEB) : json({});
      }),
    );
  });

  const opener = (label: string) =>
    within(screen.getByTestId('panel')).getByRole('button', { name: `${label} recipe` });

  /** A field of the open card, as the reader sees it: its label, then its value. */
  const field = (label: string) =>
    (screen.getByText(label).closest('.uppercase') as HTMLElement).nextElementSibling as HTMLElement;

  it('opens each surface’s preparation from its own row', async () => {
    const user = userEvent.setup();
    renderTab();
    await within(screen.getByTestId('panel')).findByText('cli/tasks-add');

    await user.click(opener('CLI'));
    const recipe = await screen.findByRole('region', { name: 'Recipe' });
    expect(opener('CLI')).toHaveAttribute('aria-pressed', 'true');
    // The cli surface's own preparation: install, build, entrypoint, env.
    expect(within(recipe).getByText('pnpm install --frozen-lockfile')).toBeInTheDocument();
    expect(within(recipe).getByText('pnpm build')).toBeInTheDocument();
    expect(within(recipe).getByText('node dist/tasks.js')).toBeInTheDocument();
    expect(within(recipe).getByText('TASKS_HOME=.tmp/tasks')).toBeInTheDocument();
    // Somebody else's fields are not this surface's preparation.
    expect(within(recipe).queryByText(/dist\/web\.js/)).toBeNull();
    expect(within(recipe).queryByText('Ready when')).toBeNull();
  });

  it('scopes the WEB row to the web surface, and a second click closes it', async () => {
    const user = userEvent.setup();
    renderTab();
    await within(screen.getByTestId('panel')).findByText('web/tasks-board');

    await user.click(opener('Web'));
    const recipe = await screen.findByRole('region', { name: 'Recipe' });
    expect(within(recipe).getByText('node dist/web.js')).toBeInTheDocument();
    expect(within(recipe).getByText('pnpm build:web')).toBeInTheDocument();
    expect(within(recipe).getByText('/health')).toBeInTheDocument();
    expect(within(recipe).queryByText('node dist/tasks.js')).toBeNull();

    await user.click(opener('Web'));
    expect(screen.queryByRole('region', { name: 'Recipe' })).toBeNull();
  });

  /**
   * ONE GRAMMAR. Every scope is the same field rows — label over value, the same
   * labels in the same order, the same value chrome. A scope is a narrowing, so
   * no scope wears a heading, a prose framing or a layout the others don't.
   */
  it('reads every scope in the SAME label-over-value rows', async () => {
    const user = userEvent.setup();
    renderTab();
    await within(screen.getByTestId('panel')).findByText('web/tasks-board');

    await user.click(opener('CLI'));
    const recipe = await screen.findByRole('region', { name: 'Recipe' });
    const labelsOf = () =>
      Array.from(recipe.querySelectorAll<HTMLElement>('.uppercase.font-semibold')).map(
        (el) => el.textContent,
      );
    expect(labelsOf()).toEqual(['Install', 'Build', 'Entry', 'Env']);
    // Label above, value below — the same two-node shape for every field.
    expect(field('Install')).toHaveTextContent('pnpm install --frozen-lockfile');
    const cliLabelClass = screen.getByText('Build').className;

    await user.click(opener('Web'));
    await screen.findByRole('region', { name: 'Recipe' });
    // The web scope is rows too — in the one field order, with no block heading
    // and no framing word of its own ("Web surface", "browsed") over them.
    expect(labelsOf()).toEqual(['Build', 'Serve', 'Ready when', 'Ready timeout']);
    expect(field('Serve')).toHaveTextContent('node dist/web.js');
    expect(field('Ready timeout')).toHaveTextContent('60000 ms');
    expect(screen.getByText('Build').className).toBe(cliLabelClass);
    expect(within(recipe).queryByText('Web surface')).toBeNull();
    expect(within(recipe).queryByText('browsed')).toBeNull();
  });

  /**
   * THE API SURFACE'S SERVER. The runner serves ONE surface for both web steps
   * and `request` steps, so a recipe with a `web` block and no `api` block still
   * has an api server — the web block's. The card shows it, and says whose it is.
   */
  it('shows the api surface the shared server, and names its owner in one line', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) =>
        String(url).includes('/guard/interfaces') ? json(ALL_SURFACES) : json({}),
      ),
    );
    renderTab();
    await within(screen.getByTestId('panel')).findByText('api/get-todos-id');

    await user.click(opener('API'));
    const recipe = await screen.findByRole('region', { name: 'Recipe' });
    // A real server, in the same rows the web scope shows it in.
    expect(within(recipe).getByText('node dist/web.js')).toBeInTheDocument();
    expect(within(recipe).getByText('/health')).toBeInTheDocument();
    expect(within(recipe).getByText('Served by the same server as the web surface.')).toBeInTheDocument();
    // …and never the line that says the opposite of what runs.
    expect(within(recipe).queryByText(/declares no preparation/)).toBeNull();
  });

  it('leaves a repo’s OWN api block as itself — no shared-server line', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) =>
        String(url).includes('/guard/interfaces') ? json(ALL_SURFACES) : json({}),
      ),
    );
    renderTab('/repos/r?tab=interfaces', undefined, { recipe: API_RECIPE });
    await within(screen.getByTestId('panel')).findByText('api/get-todos-id');

    await user.click(opener('API'));
    const recipe = await screen.findByRole('region', { name: 'Recipe' });
    expect(within(recipe).getByText('node dist/server.js')).toBeInTheDocument();
    expect(within(recipe).getByText('up: docker compose up -d --wait')).toBeInTheDocument();
    expect(within(recipe).queryByText(/same server as the web surface/)).toBeNull();
    // Not the web block's server either — the api surface has its own.
    expect(within(recipe).queryByText('node dist/web.js')).toBeNull();
  });

  it('says nothing is declared when the recipe serves no surface at all', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) =>
        String(url).includes('/guard/interfaces') ? json(ALL_SURFACES) : json({}),
      ),
    );
    renderTab('/repos/r?tab=interfaces', undefined, { recipe: CLI_ONLY_RECIPE });
    await within(screen.getByTestId('panel')).findByText('api/get-todos-id');

    await user.click(opener('API'));
    const recipe = await screen.findByRole('region', { name: 'Recipe' });
    expect(
      within(recipe).getByText('The recipe declares no preparation for this surface.'),
    ).toBeInTheDocument();
    expect(within(recipe).queryByText(/same server as the web surface/)).toBeNull();
  });

  it('picking an interface navigates AWAY from the recipe — one body, one subject', async () => {
    const user = userEvent.setup();
    renderTab();
    await within(screen.getByTestId('panel')).findByText('cli/tasks-add');
    await user.click(opener('CLI'));
    await screen.findByRole('region', { name: 'Recipe' });

    await user.click(within(screen.getByTestId('panel')).getByText('cli/tasks-add'));
    expect(screen.queryByRole('region', { name: 'Recipe' })).toBeNull();
    expect(opener('CLI')).toHaveAttribute('aria-pressed', 'false');
    expect(await screen.findByRole('group', { name: 'Interface cli/tasks-add' })).toBeInTheDocument();
  });

  it('reads the stored file verbatim in raw mode — the WHOLE file, lazily', async () => {
    const user = userEvent.setup();
    renderTab();
    await within(screen.getByTestId('panel')).findByText('web/tasks-board');
    await user.click(opener('Web'));
    // Nothing fetched for a reading nobody asked for.
    expect(recipeRawRequests).toHaveLength(0);

    const modes = within(await screen.findByRole('region', { name: 'Recipe' })).getByRole('group', {
      name: 'View mode',
    });
    await user.click(within(modes).getByRole('button', { name: 'JSON' }));
    const raw = await screen.findByLabelText('recipe source');
    // The scope is the CARD's; the file is never half-shown.
    expect(raw.textContent).toContain('dist/tasks.js');
    expect(raw.textContent).toContain('dist/web.js');
    expect(recipeRawRequests).toHaveLength(1);
    // A SINGLETON artifact: one recipe per repo, addressed by no id.
    expect(recipeRawRequests[0]).not.toContain('id=');
  });

  it('shows the file as the server masked it — the raw mode is no secret door', async () => {
    const user = userEvent.setup();
    renderTab();
    await within(screen.getByTestId('panel')).findByText('cli/tasks-add');
    await user.click(opener('CLI'));
    await user.click(
      within(within(await screen.findByRole('region', { name: 'Recipe' })).getByRole('group', { name: 'View mode' }))
        .getByRole('button', { name: 'JSON' }),
    );
    const raw = await screen.findByLabelText('recipe source');
    await waitFor(() => expect(raw.textContent).toContain('inline value, masked'));
    // The capability stays readable; the value never arrives to be shown.
    expect(raw.textContent).toContain('"header": "Authorization"');
    expect(raw.textContent).not.toMatch(/sk-|secret/);
  });

  it('offers nothing at all when the repo has no recipe yet', async () => {
    renderTab('/repos/r?tab=interfaces', undefined, { recipe: null });
    await within(screen.getByTestId('panel')).findByText('cli/tasks-add');
    expect(within(screen.getByTestId('panel')).queryByRole('button', { name: /recipe/i })).toBeNull();
  });
});

/**
 * WHERE THE RECIPE ROWS SIT, and what they are made of. All of them together at
 * the TOP of the panel — one per surface the catalog shows, in the catalog's own
 * surface order — and each one a ROW of the list: the same wrapper, the same
 * selected paint, the same hover as the interface rows under it. Not a pill, not
 * a toolbar button, not a lead floating inside a group.
 */
describe('Interfaces tab — the recipe rows are the panel’s first rows', () => {
  const list = () => screen.getByRole('list', { name: 'Interface catalog' });
  const recipeRow = (label: string) => within(list()).getByRole('button', { name: `${label} recipe` });

  const stub = (view: GuardInterfacesView) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => (String(url).includes('/guard/interfaces') ? json(view) : json({}))),
    );

  it('leads the panel with a row per surface, before any interface group', async () => {
    stub(ALL_SURFACES);
    renderTab();
    await within(screen.getByTestId('panel')).findByText('cli/tasks-add');
    // Every surface the catalog has, in the order the catalog groups them, and
    // all of them ahead of the first group header.
    expect(catalogOutline()).toEqual([
      'CLI recipe',
      'API recipe',
      'Web recipe',
      '# CLI',
      'cli/tasks-add',
      '# API',
      'api/get-todos-id',
      '# Web',
      'web/tasks-board',
    ]);
  });

  it('wears the list’s row idiom — the same class as an interface row, no pill', async () => {
    const user = userEvent.setup();
    stub(ALL_SURFACES);
    renderTab();
    const iface = (await within(screen.getByTestId('panel')).findByText('cli/tasks-add')).closest(
      '[role="listitem"]',
    ) as HTMLElement;

    // The row is the row: same wrapper, same paint, same hover. Not a bordered
    // pill sitting on top of the list.
    expect(recipeRow('CLI').className).toBe(iface.className);
    expect(recipeRow('CLI').className).not.toMatch(/rounded/);
    expect(recipeRow('CLI').closest('[role="listitem"]')).not.toBeNull();

    // Selected, it takes the selected paint an interface row takes — and says so
    // as a toggle, which an interface row is not.
    await user.click(recipeRow('CLI'));
    expect(recipeRow('CLI')).toHaveAttribute('aria-pressed', 'true');
    expect(recipeRow('CLI').className).toMatch(/bg-primary\/10/);
    expect(recipeRow('Web')).toHaveAttribute('aria-pressed', 'false');
  });

  it('narrows with the list: filtered to one surface, only that surface’s recipe', async () => {
    const user = userEvent.setup();
    stub(ALL_SURFACES);
    renderTab();
    await within(screen.getByTestId('panel')).findByText('cli/tasks-add');

    await user.click(
      within(screen.getByRole('group', { name: 'Filter by surface' })).getByRole('button', { name: 'API 1' }),
    );
    expect(catalogOutline()).toEqual(['API recipe', '# API', 'api/get-todos-id']);
  });
});

/**
 * One entry is one invocable thing, so the tree a reader knows — `rules`,
 * `analyses` — only survives in the catalog's per-entry FAMILY. The panel shows it
 * as the inner level of the one grouping mechanism: surface outside, family inside.
 */
describe('Interfaces tab — the families inside a surface', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => (String(url).includes('/guard/interfaces') ? json(FAMILIES) : json({}))),
    );
  });

  it('nests each family under its surface, in first-seen order and scoped to it', async () => {
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });
    // Families read in the order the catalog first names them, never alphabetically,
    // and the two `rules` headers are two families — one per surface.
    expect(catalogOutline()).toEqual([
      'CLI recipe',
      'Web recipe',
      '# CLI',
      'cli/version',
      '# rules',
      'cli/rules-list',
      'cli/rules-disable',
      '# analyses',
      'cli/analyses-list',
      '# Web',
      '# rules',
      'web/rules-page',
    ]);
  });

  it('keeps the surface as the outer level and the interface rows as they were', async () => {
    const user = userEvent.setup();
    renderTab();
    const list = await screen.findByRole('list', { name: 'Interface catalog' });
    // The surface header still carries its own tally over every row beneath it.
    expect(within(list).getByText('CLI').closest('div')).toHaveTextContent('4');
    // A family header is the group NAME and nothing else — no tally line of its own
    // beside it, no count of flows, no prose.
    expect(within(list).getByText('analyses').closest('div')?.textContent).toBe('analyses1');
    // Rows are unchanged: a click still previews the interface into the URL.
    await user.click(within(list).getByText('cli/rules-disable'));
    expect(search()).toContain('ginterface=cli%2Frules-disable');
  });

  it('heads the family as the INNER level — a quieter header, its rows indented under it', async () => {
    renderTab();
    const list = await screen.findByRole('list', { name: 'Interface catalog' });
    const header = (label: string) => within(list).getByText(label).closest('.sticky') as HTMLElement;

    // The surface keeps the chrome every outer group wears.
    expect(header('CLI').className).toMatch(/font-semibold/);
    expect(header('CLI').className).not.toMatch(/pl-6/);

    // The family is the same header one step down — lighter and indented, never a
    // second full-weight header the eye reads as another surface.
    expect(header('analyses').className).toMatch(/font-medium/);
    expect(header('analyses').className).not.toMatch(/font-semibold/);
    expect(header('analyses').className).not.toMatch(/pl-6/);

    // …and its rows line up under its label, while an entry in no family stays at
    // the surface's own edge — so which rows a family owns is readable off the gutter.
    const row = (id: string) => within(list).getByText(id).closest('[role="listitem"]') as HTMLElement;
    expect(row('cli/analyses-list').className).not.toMatch(/pl-6/);
    expect(row('cli/version').className).not.toMatch(/pl-6/);
  });

  it('leaves a catalog with no families flat — no invented "other" group', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => (String(url).includes('/guard/interfaces') ? json(MAPPED) : json({}))),
    );
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });
    expect(catalogOutline()).toEqual([
      'CLI recipe',
      '# CLI',
      'cli/tasks-add',
      'cli/tasks-list',
      'cli/tasks-done',
      'cli/tasks-purge',
      'cli/telemetry',
    ]);
  });
});

/**
 * The CONTRACT block: the CALLING INTERFACE and nothing else — the grammar of
 * every command in the tree and each command's input/output, the io rendered as
 * FLAT ROWS (one fact, one line, its condition after a `·`) because a fact list is
 * not tabular data and the artifact carries no prose. The page reads once:
 * nothing here repeats the interface name, its entry or its steps. The two honesty
 * rules are asserted directly — `unknown` reads as unknown, and a list the
 * derivation never established renders nothing rather than a confident "none".
 */
describe('Interfaces tab — the contract', () => {
  const openAdd = () => renderPane(WITH_CONTRACT, '/repos/r?tab=interfaces&ginterface=cli%2Ftasks-add');

  /** The panel a block lives in — `--priority` is a grammar row AND a fact row. */
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

  it('renders every io fact as ONE flat row — chip, the fact, · the condition', async () => {
    openAdd();
    expect(await screen.findByText('Input and output')).toBeInTheDocument();
    const consumes = panel('Consumes');
    const produces = panel('Produces');

    // A prompt is what a TTY step must answer: its kind, the question in quotes,
    // and the answers it offers — one line, no Kind/Question/Answer columns.
    const prompt = consumes.getByText('“Where should tasks live?”').closest('li')!;
    expect(within(prompt).getByText('select')).toBeInTheDocument();
    expect(within(prompt).getByText('home | here')).toBeInTheDocument();
    expect(within(prompt).getByText(/^answers:/)).toBeInTheDocument();
    expect(within(prompt).getByText('no config saved')).toBeInTheDocument();

    // An env read is a variable a scenario sets — no chip, it needs none.
    const env = consumes.getByText('TASKS_HOME').closest('li')!;
    expect(within(env).getByText('relocating the store')).toBeInTheDocument();

    // An output fact is a marker ON a stream — the assertion target, verbatim.
    const created = produces.getByText(/^Created task$/).closest('li')!;
    expect(within(created).getByText('stdout')).toBeInTheDocument();
    // A fact with no condition ENDS at the fact: no separator, no invented word.
    expect(created.textContent).toBe('stdoutCreated task ');
    const readOnly = produces.getByText('store is read-only').closest('li')!;
    expect(within(readOnly).getByText('stderr')).toBeInTheDocument();
    expect(within(readOnly).getByText('the store cannot be written')).toBeInTheDocument();

    // Exit statuses with their conditions — and `unknown` shown AS unknown.
    expect(produces.getByText('0')).toBeInTheDocument();
    expect(produces.getByText('unknown')).toBeInTheDocument();
    expect(produces.getByText('an unwritable store declares no exit path in code')).toBeInTheDocument();
    // An UNKNOWN is grey, never a warning colour — nothing was established here,
    // and amber/orange are banned across guard.
    expect(produces.getByText('unknown').className).toMatch(/slate|muted/);
    expect(produces.getByText('unknown').className).not.toMatch(/amber|orange/);

    // An authored EMPTY list is a fact: under its own heading it reads "none",
    // it is never hidden and never confused with a heading that was left off.
    const writes = within(produces.getByText('Writes').parentElement as HTMLElement);
    expect(writes.getByText('none')).toBeInTheDocument();
  });

  it('renders a row shape as its template, slots visible inside it', async () => {
    openAdd();
    expect(await screen.findByText('Row shapes')).toBeInTheDocument();
    const rows = panel('Row shapes');

    // The header line: printed once, and its slots are marked IN the literal
    // text — a template with its slots stripped is a line no run ever prints.
    const header = rows.getByText('<shown>').closest('li')!;
    expect(header.querySelector('.font-mono')!.textContent).toBe(
      'Tasks for <list>: <shown> shown (<done> done)',
    );
    expect(within(header).getByText('stdout')).toBeInTheDocument();
    expect(within(header).getByText('header')).toBeInTheDocument();

    // The repeating line — its role, and the one condition it holds under.
    const row = rows.getByText('<state>').closest('li')!;
    expect(row.querySelector('.font-mono')!.textContent).toBe('<state>  <title>');
    expect(within(row).getByText('row')).toBeInTheDocument();
    expect(within(row).getByText('one line per task')).toBeInTheDocument();

    // A slot carries its own vocabulary: the closed set on an enum, the kind on
    // the rest — so what the line may say is readable off the line itself.
    expect(screen.getByText('One of: todo | done')).toBeInTheDocument();
    expect(screen.getAllByText(/^A count —/).length).toBeGreaterThan(0);
  });

  it('renders a prompt with the keystroke that submits its answer, and nothing when unestablished', async () => {
    openAdd();
    expect(await screen.findByText('Input and output')).toBeInTheDocument();
    const consumes = panel('Consumes');

    // A select is typed and submitted with Enter; a y/n confirm submits on the
    // character itself — the difference a scripted TTY answer has to get right.
    const select = consumes.getByText('“Where should tasks live?”').closest('li')!;
    expect(within(select).getByText('submit: enter')).toBeInTheDocument();
    const confirm = consumes.getByText('“Overwrite it?”').closest('li')!;
    expect(within(confirm).getByText('submit: char')).toBeInTheDocument();

    // Unestablished says nothing rather than guessing a plausible default.
    const unknown = consumes.getByText('“Name it?”').closest('li')!;
    expect(unknown.textContent).toBe('text“Name it?”');
  });

  it('renders no Row shapes block for a command whose listing shape was never established', async () => {
    const command = WITH_CONTRACT.interfaces[0].contract!.commands[0];
    const noRows = {
      ...WITH_CONTRACT,
      interfaces: [
        {
          ...WITH_CONTRACT.interfaces[0],
          contract: {
            ...WITH_CONTRACT.interfaces[0].contract!,
            commands: [
              { ...command, io: { ...command.io, produces: { output: command.io!.produces!.output } } },
              WITH_CONTRACT.interfaces[0].contract!.commands[1],
            ],
          },
        },
        WITH_CONTRACT.interfaces[1],
      ],
    };
    renderPane(noRows, '/repos/r?tab=interfaces&ginterface=cli%2Ftasks-add');
    expect(await screen.findByText('Output')).toBeInTheDocument();
    // Absence renders nothing — heading included; it is never an empty "none".
    expect(screen.queryByText('Row shapes')).not.toBeInTheDocument();
  });

  it('rows are hairline-separated lines — no fact table, no column headers, no box', async () => {
    openAdd();
    expect(await screen.findByText('Input and output')).toBeInTheDocument();
    const io = screen.getByText('Input and output').parentElement as HTMLElement;

    // The only tables on the page are the grammar and the positionals; the io
    // side has none, and therefore none of their headers either.
    expect(within(io).queryAllByRole('table')).toHaveLength(0);
    for (const head of ['Stream', 'Marker', 'When', 'Kind', 'Question', 'Answer', 'Exit', 'Variable']) {
      expect(within(io).queryByText(head)).toBeNull();
    }
    // Nothing in the io block is boxed: dividers carry the structure, so no
    // container draws a border of its own (`divide-*` is not one).
    for (const el of Array.from(io.querySelectorAll<HTMLElement>('div, ul, li'))) {
      const boxed = el.className.split(/\s+/).some((c) => c === 'border' || c.startsWith('border-'));
      expect(boxed, `boxed container: ${el.className}`).toBe(false);
    }
    const row = within(io).getByText('TASKS_HOME').closest('li')!;
    expect((row.parentElement as HTMLElement).className).toMatch(/divide-y/);
  });

  it('renders the reads as path · when — the seeding side of the file contract', async () => {
    renderPane(WITH_READS, '/repos/r?tab=interfaces&ginterface=cli%2Ftasks-add');
    expect(await screen.findByText('Input and output')).toBeInTheDocument();

    // The block lives on the CONSUMES side: a scenario seeds these before the run.
    const consumes = panel('Consumes');
    expect(consumes.getByText('Reads')).toBeInTheDocument();
    const reads = within(screen.getByText('Reads').parentElement as HTMLElement);

    const store = reads.getByText('~/.tasks.json').closest('li')!;
    expect(within(store).getByText('the store the listing renders')).toBeInTheDocument();
    // A read with no condition ends at the path — the same idiom every kind uses.
    const config = reads.getByText('<repo>/.tasks/config.json').closest('li')!;
    expect(config.textContent).toBe('<repo>/.tasks/config.json');
  });

  it('says "none" for a command established as reading nothing', async () => {
    renderPane(WITH_READS, '/repos/r?tab=interfaces&ginterface=cli%2Ftasks-add&gcmd=tasks+purge');
    expect(await screen.findByText('Delete every completed task.')).toBeInTheDocument();
    const reads = within(screen.getByText('Reads').parentElement as HTMLElement);
    expect(reads.getByText('none')).toBeInTheDocument();
    // Nothing else was invented for it: the unestablished blocks stay silent.
    expect(screen.queryByText('Prompts')).not.toBeInTheDocument();
    expect(screen.queryByText('Environment')).not.toBeInTheDocument();
  });

  it('renders nothing for a block the derivation never established', async () => {
    openAdd();
    expect(await screen.findByText('Input and output')).toBeInTheDocument();
    // No prose blocks survive the narrowing, and an unestablished one is silent:
    // this command declares no writes-bearing consumes side, and nobody
    // established what it reads — so the Reads block is absent, not empty.
    expect(screen.queryByText('Reads')).not.toBeInTheDocument();
    expect(screen.queryByText('Side effects')).not.toBeInTheDocument();
    expect(screen.queryByText('State files')).not.toBeInTheDocument();
    expect(screen.queryByText('Value sets')).not.toBeInTheDocument();
  });

  it('gives a command with no io no panel at all', async () => {
    renderPane(WITH_CONTRACT, '/repos/r?tab=interfaces&ginterface=cli%2Ftasks-add&gcmd=tasks+purge');
    expect(await screen.findByText('Delete every completed task.')).toBeInTheDocument();
    expect(screen.queryByText('Input and output')).not.toBeInTheDocument();
    expect(screen.queryByText('Where should tasks live?')).not.toBeInTheDocument();
  });

  it('reads once: no step list, no Contract header, no summary echo', async () => {
    openAdd();
    expect(await screen.findByText('Grammar')).toBeInTheDocument();

    // The sequence diagram carries the steps; a typed list of the same steps is
    // the same reading twice, so the pane no longer has one.
    expect(screen.queryByText('Steps')).not.toBeInTheDocument();
    // The contract does not restate what the pane header already said.
    expect(screen.queryByText('Contract')).not.toBeInTheDocument();
    expect(screen.queryByText('`tasks add` and its `--json` mode.')).not.toBeInTheDocument();

    // What a caller needs is all still here.
    expect(screen.getByText('Positional arguments')).toBeInTheDocument();
    expect(screen.getByText('Input and output')).toBeInTheDocument();
  });

  it('has no behavior notes — the artifact carries facts, so the view has none to render', async () => {
    openAdd();
    expect(await screen.findByText('Input and output')).toBeInTheDocument();
    // The section is gone with the field: prose about behavior is neither stored
    // nor displayed, and nothing was left behind to render an empty heading.
    expect(screen.queryByText('Behavior notes')).not.toBeInTheDocument();
    expect(screen.queryByText('Notes')).not.toBeInTheDocument();
    expect(screen.queryByText(/Re-running with the same title/)).not.toBeInTheDocument();
  });

  it('prints the command path only where it names one command of a TREE', async () => {
    // A one-command interface: its path IS the interface title the reader just
    // passed, so the contract adds no occurrence of it anywhere on the page.
    const oneCommand: GuardInterfacesView = {
      ...MAPPED,
      interfaces: [
        { ...MAPPED.interfaces[0], contract: { ...CONTRACT, commands: [CONTRACT.commands[0]] } },
        MAPPED.interfaces[1],
      ],
    };
    renderPane(oneCommand, '/repos/r?tab=interfaces&ginterface=cli%2Ftasks-add');
    expect(await screen.findByText('Grammar')).toBeInTheDocument();
    // No command nav either — there is nothing to choose between.
    expect(screen.queryByRole('list', { name: 'Commands' })).toBeNull();
    const alone = screen.getAllByText(/^tasks add$/).length;

    // The same interface as a TREE: the path now appears twice more — once in the
    // nav row, once as the heading of the command on screen.
    cleanup();
    openAdd();
    expect(await screen.findByRole('list', { name: 'Commands' })).toBeInTheDocument();
    expect(screen.getAllByText(/^tasks add$/)).toHaveLength(alone + 2);
  });

  it('previews a command on single click and pins it on double click — the same tab model as the interface rows', async () => {
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
    renderPane(WITH_CONTRACT, '/repos/r?tab=interfaces&ginterface=cli%2Ftasks-add&gcmd=tasks+purge');
    expect(await screen.findByText('Delete every completed task.')).toBeInTheDocument();
    // `tasks purge` declares no positionals at all — established as none.
    const positionals = screen.getByText('Positional arguments').parentElement as HTMLElement;
    expect(within(positionals).getByText('none')).toBeInTheDocument();
  });

  it('says so plainly when the catalog carries no contract — nothing is filled in', async () => {
    renderPane(WITH_CONTRACT, '/repos/r?tab=interfaces&ginterface=cli%2Ftasks-list');
    expect(await screen.findByText('No contract derived')).toBeInTheDocument();
    expect(screen.getByText(/nothing is filled in on its behalf/)).toBeInTheDocument();
    expect(screen.queryByText('Grammar')).not.toBeInTheDocument();
    expect(screen.queryByText('Input and output')).not.toBeInTheDocument();
  });
});

/**
 * The QUESTION SEQUENCE: for an interactive command, the questions in the order
 * they arrive, with the earlier answer that reveals each conditional one. It is
 * what makes an interactive command scriptable off the page — read top to bottom
 * and you have the answers to write. `unknown` is shown, never hidden: a dialogue
 * the mapper still owes is information, and a page that quietly dropped it would
 * read exactly like a command that asks its questions straight through.
 */
describe('Interfaces tab — the question sequence', () => {
  /** The three questions `tasks add` already carries, put in order and branched. */
  const SEQUENCE = [
    { prompt: 'Where should tasks live?', kind: 'select' as const },
    {
      prompt: 'Overwrite it?',
      kind: 'confirm' as const,
      after: { prompt: 'Where should tasks live?', answer: 'here' },
    },
    {
      prompt: 'Name it?',
      kind: 'text' as const,
      after: { prompt: 'Overwrite it?', answer: 'yes' },
      repeats: 'once per task in the batch',
    },
  ];

  const withSequence = (sequence: unknown): GuardInterfacesView => ({
    ...MAPPED,
    interfaces: [
      {
        ...MAPPED.interfaces[0],
        contract: {
          ...CONTRACT,
          commands: [{ ...CONTRACT.commands[0], sequence }, CONTRACT.commands[1]],
        } as NonNullable<GuardInterfacesView['interfaces'][number]['contract']>,
      },
      MAPPED.interfaces[1],
    ],
  });

  const open = async (view: GuardInterfacesView) => {
    renderPane(view, '/repos/r?tab=interfaces&ginterface=cli%2Ftasks-add');
    return within((await screen.findByText('Question sequence')).parentElement as HTMLElement);
  };

  it('lists the questions in the order they arrive, each with the kind that answers it', async () => {
    const sequence = await open(withSequence(SEQUENCE));

    // Every question is on the page, in arrival order — that IS the script.
    expect(sequence.getAllByText(/^“/).map((el) => el.textContent)).toEqual([
      '“Where should tasks live?”',
      '“Overwrite it?”',
      '“Name it?”',
    ]);

    // The kind rides with the question, so the answer can be written from here.
    const first = sequence.getByText('“Where should tasks live?”').closest('li')!;
    expect(within(first).getByText('select')).toBeInTheDocument();
    expect(within(sequence.getByText('“Name it?”').closest('li')!).getByText('text')).toBeInTheDocument();
  });

  it('labels each branch once and nests the questions that answer reveals', async () => {
    const sequence = await open(withSequence(SEQUENCE));

    // A conditional question sits under a short label naming the earlier
    // question and the answer that opens it — one label per branch, not one
    // per question.
    const branch = sequence.getByText('only after “Where should tasks live?” = here');
    expect(within(branch.parentElement as HTMLElement).getByText('“Overwrite it?”')).toBeInTheDocument();

    // A confirm branches on `yes` — the label says which of its two answers.
    const confirmBranch = sequence.getByText('only after “Overwrite it?” = yes');
    expect(within(confirmBranch.parentElement as HTMLElement).getByText('“Name it?”')).toBeInTheDocument();

    // The first question is on the main run and wears no condition at all.
    const first = sequence.getByText('“Where should tasks live?”').closest('li')!;
    expect(first.textContent).not.toMatch(/only after/);
  });

  it('says a question is re-asked, and the one condition it is re-asked under', async () => {
    const sequence = await open(withSequence(SEQUENCE));
    const repeated = sequence.getByText('“Name it?”').closest('li')!;
    expect(within(repeated).getByText('repeats')).toBeInTheDocument();
    expect(within(repeated).getByText('once per task in the batch')).toBeInTheDocument();
  });

  it('shows an UNKNOWN sequence as its own line — a dialogue the mapper still owes', async () => {
    const sequence = await open(withSequence('unknown'));
    const unknown = sequence.getByText('sequence unknown');
    // Grey, like every other unestablished value — never a warning colour.
    expect(unknown.className).toMatch(/slate|muted/);
    expect(unknown.className).not.toMatch(/amber|orange/);
    // No half-rendered dialogue beside it: the ORDER is what is unestablished.
    expect(sequence.queryByText(/^“/)).toBeNull();
    // The questions themselves are still on the page, in the Consumes panel.
    expect(screen.getByText('“Where should tasks live?”')).toBeInTheDocument();
  });

  it('renders no sequence block at all for a command that carries none', async () => {
    renderPane(withSequence(undefined), '/repos/r?tab=interfaces&ginterface=cli%2Ftasks-add');
    expect(await screen.findByText('Input and output')).toBeInTheDocument();
    expect(screen.queryByText('Question sequence')).not.toBeInTheDocument();
    expect(screen.queryByText('sequence unknown')).not.toBeInTheDocument();
  });
});

/**
 * THE STATE CONTRACT of a web task, after the named-states rework (2026-08-11).
 * Both fields are now IDS into the area's registry, and the per-step prose is
 * gone — so the pane names two states and the diagram is one message per step,
 * with no interaction-change sentences threaded between them.
 */
describe('a web task’s state contract', () => {
  const WEB: GuardInterfacesView['interfaces'][number] = {
    id: 'web/silence-rule-from-violation-card',
    type: 'web',
    title: 'Silence a noisy rule from a violation card',
    group: 'repos',
    entry: { method: 'GET', path: '/repos/{repoId}' },
    steps: [
      { kind: 'activate', target: 'button "More actions"' },
      { kind: 'activate', target: 'menuitem "Disable rule for this repo"' },
    ],
    startingState: 'repo-report-open',
    endState: 'rule-silenced',
    fingerprint: 'sha256:web',
    flows: [],
    scenarioIds: [],
  };

  const openWebTask = () =>
    renderPane(
      { ...MAPPED, interfaces: [WEB] },
      '/repos/r?tab=interfaces&ginterface=web%2Fsilence-rule-from-violation-card',
    );

  it('names the two states it assumes and leaves, as ids', async () => {
    openWebTask();
    expect(await screen.findByText('Starting state')).toBeInTheDocument();
    const start = screen.getByText('repo-report-open');
    const end = screen.getByText('rule-silenced');
    expect(screen.getByText('End state')).toBeInTheDocument();
    // Mono, because they are ids: two tasks chain when these match exactly.
    expect(start.className).toMatch(/font-mono/);
    expect(end.className).toMatch(/font-mono/);
  });

  it('draws one message per step — no state prose between them', async () => {
    openWebTask();
    const diagram = await screen.findByRole('group', {
      name: 'Interface web/silence-rule-from-violation-card',
    });
    expect(within(diagram).getAllByTitle(/^activate /).map((el) => el.textContent)).toEqual([
      'activate button "More actions"',
      'activate menuitem "Disable rule for this repo"',
    ]);
    // Two steps, two messages: nothing is drawn flowing back from the surface.
    expect(diagram.querySelectorAll('[title]')).toHaveLength(2);
  });
});
