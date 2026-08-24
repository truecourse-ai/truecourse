/**
 * Guard INTERFACES-tab tests — the code half's read surface, as SCREENS,
 * OPERATIONS AND COMMANDS (2026-08-24).
 *
 * The panel is a flat SKIM with nothing expandable: one row per web SCREEN (a
 * top-level place, tallying its own interfaces and every part's), per api
 * OPERATION (a coloured method and a path, its endpoint's rows adjacent) or per
 * cli COMMAND. A screen with nothing to do — and an api ENDPOINT no operation
 * serves — is counted out under the rows, never listed. The pane is that row in
 * full. What is covered here:
 *
 *  - the rows of each surface, their tallies, the loose ENTRIES a screens surface
 *    has no place for, and the hidden-empty rule;
 *  - the SCREEN page: the classic header (surface, kind, place id, route +
 *    mapping, description) over ONE Contract section — the ACTIONS table across
 *    every part, each row opening in place, and THE PAGE SHOWS table over every
 *    readable;
 *  - the OPERATION page, opened DIRECTLY with no endpoint list in between, its
 *    endpoint and siblings as one line of chips; and the COMMAND page (one
 *    interface, its contract straight away);
 *  - an expanded action's own facts — the sequence, `apiEffects` as a calls
 *    block, and the world it leaves with the registry's own line. Both were gaps:
 *    a web task used to dead-end at "No contract derived" and `apiEffects` was
 *    rendered nowhere at all;
 *  - CROSS-NAVIGATION: `?ginterface=<id>` still names an interface, and the pane
 *    resolves it to the ROW that owns it — a task on a panel opens the SCREEN
 *    that panel is part of, an operation opens itself — then expands and scrolls;
 *  - the SURFACE FILTER, the per-surface RECIPE rows, and the cli/api contracts,
 *    which the redesign did not touch.
 *
 * The join and the minting rules are pinned in `interface-pom.test.ts`; this file
 * is what the components DO with them.
 *
 * Fixture: the plan's taskbird cli catalog — three grounded interfaces plus one no
 * flow mentions (the candidate spec gap) — plus a small web catalog with a real
 * registry.
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
import { useGuardInterfaceMember, useGuardInterfaceTabs } from '@/hooks/useGuardInterfaceTabs';

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
  { surface: 'cli', label: 'CLI', runnable: true, interfaces: 5, resources: 2, detected: true, source: 'tree' },
  { surface: 'api', label: 'API', runnable: true, interfaces: 0, resources: 0, detected: false },
  { surface: 'web', label: 'Web', runnable: false, waitingLabel: 'Needs web driver', interfaces: 0, resources: 0, detected: false },
  { surface: 'desktop', label: 'Desktop', runnable: false, waitingLabel: 'Needs desktop driver', interfaces: 0, resources: 0, detected: false },
];

const FLOW_TITLE = 'A user creates a task, sees it listed, and completes it';
const BLOCKED_FLOW_ID = 'manage-telemetry-settings';

/** A realized usage — a committed scenario grounds on the interface. */
const usedBy = (flowId: string, title: string) => ({ flowId, title, realized: true });

/**
 * The cli registry: the `tasks` command group, with `tasks telemetry` hanging off
 * it — the nesting a page-object reading of a command tree needs.
 */
const CLI_PLACES: NonNullable<GuardInterfacesView['resources']>['cli'] = [
  { id: 'tasks', kind: 'command-group', title: 'tasks' },
  { id: 'tasks-telemetry', kind: 'command-group', title: 'tasks telemetry', of: 'tasks' },
];

const iface = (
  slug: string,
  title: string,
  flags: string[],
  flows: GuardInterfacesView['interfaces'][number]['flows'],
  place = 'tasks',
) => ({
  id: `cli/${slug}`,
  type: 'cli' as const,
  title,
  entry: { command: title.split(' ') },
  steps: [{ kind: 'invoke' as const, command: title.split(' '), flags }],
  resource: place,
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
    // Matched by a flow whose authoring was refused — used, never exercised. It
    // lives one level down, on its own command group.
    iface(
      'telemetry',
      'tasks telemetry off',
      [],
      [
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
      ],
      'tasks-telemetry',
    ),
  ],
  resources: { cli: CLI_PLACES },
  surfaces: SURFACES,
  totals: { interfaces: 5, detectedSurfaces: 1, grounded: 4, ungrounded: 1 },
};

/** A repo with two surfaces found — one runnable today, one still awaiting its driver. */
const CLI_AND_WEB: GuardInterfacesView = {
  ...MAPPED,
  interfaces: [
    ...MAPPED.interfaces,
    {
      id: 'web/open-tasks-board',
      type: 'web',
      title: 'Open the task board',
      entry: { method: 'GET', path: '/tasks' },
      steps: [{ kind: 'navigate', route: '/tasks' }],
      to: 'tasks-board',
      fingerprint: 'sha256:web-tasks-board',
      flows: [],
      scenarioIds: [],
      source: 'probes',
    },
  ],
  resources: { cli: CLI_PLACES, web: [{ id: 'tasks-board', kind: 'screen', title: 'the task board' }] },
  surfaces: SURFACES.map((s) =>
    s.surface === 'web' ? { ...s, interfaces: 1, resources: 1, detected: true, source: 'probes' as const } : s,
  ),
  totals: { interfaces: 6, detectedSurfaces: 2, grounded: 4, ungrounded: 2 },
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
      resource: 'todos',
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
      resource: 'todos',
      fingerprint: 'sha256:patch-todos-id',
      flows: [],
      scenarioIds: [],
      source: 'tree' as const,
      specOnly: true as const,
    },
  ],
  resources: {
    api: [
      { id: 'todos', kind: 'rest-noun', title: '/todos' },
      // A noun the derivation named and nothing serves — counted out, not listed.
      { id: 'lists', kind: 'rest-noun', title: '/lists' },
    ],
  },
  surfaces: SURFACES.map((s) =>
    s.surface === 'api'
      ? { ...s, interfaces: 2, resources: 1, detected: true, source: 'tree' as const }
      : s.surface === 'cli'
        ? { ...s, interfaces: 0, resources: 0, detected: false }
        : s,
  ),
  totals: { interfaces: 2, detectedSurfaces: 1, grounded: 1, ungrounded: 1 },
};

/**
 * A catalog with ALL THREE runnable surfaces in it — one place each, and so one
 * recipe row each. The case that proves no surface is quietly left without one.
 */
const ALL_SURFACES: GuardInterfacesView = {
  ...MAPPED,
  interfaces: [
    MAPPED.interfaces[0],
    API_MAPPED.interfaces[0],
    CLI_AND_WEB.interfaces[CLI_AND_WEB.interfaces.length - 1],
  ],
  resources: {
    cli: CLI_PLACES,
    api: API_MAPPED.resources!.api!,
    web: CLI_AND_WEB.resources!.web!,
  },
  surfaces: SURFACES.map((s) =>
    s.surface === 'cli' || s.surface === 'api' || s.surface === 'web'
      ? { ...s, interfaces: 1, resources: 1, detected: true, source: 'tree' as const }
      : s,
  ),
  totals: { interfaces: 3, detectedSurfaces: 3, grounded: 2, ungrounded: 1 },
};

/**
 * An interface carrying the FULL cli contract — ONE command (the union's cli
 * member is singular: one entry is one invocable thing), io as structured FACTS
 * (markers, exit statuses, writes, prompts, env reads), an `unknown` exit status
 * and an authored empty list ("none", established). There is no prose anywhere in
 * it: the tab renders the CALLING INTERFACE and nothing else.
 */
const CONTRACT: NonNullable<GuardInterfacesView['interfaces'][number]['contract']> = {
  surface: 'cli',
  summary: '`tasks add` and its `--json` mode.',
  command: {
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
};

/** A second cli entry, carrying no io at all — there is no panel to fill for it. */
const PURGE_CONTRACT: NonNullable<GuardInterfacesView['interfaces'][number]['contract']> = {
  surface: 'cli',
  command: {
    path: ['tasks', 'purge'],
    description: 'Delete every completed task.',
    options: [{ flag: '--force', takesValue: false, valueRequired: false, scope: 'command' }],
    positionals: [],
  },
};

/** The purge entry with its READ side established as NONE — "none", out loud. */
const PURGE_READS_NOTHING: NonNullable<GuardInterfacesView['interfaces'][number]['contract']> = {
  surface: 'cli',
  command: { ...PURGE_CONTRACT.command, io: { consumes: { reads: [] } } },
};

/** The api member: an operation in HTTP's own vocabulary, no argv costume. */
const OPERATION: NonNullable<GuardInterfacesView['interfaces'][number]['contract']> = {
  surface: 'api',
  summary: 'Create a todo.',
  operation: {
    description: 'Appends the todo and answers the created row.',
    request: {
      params: [{ name: 'id', required: true, description: 'The list id.' }],
      query: [{ name: 'dryRun', required: false, choices: ['1'], default: '0' }],
      body: [
        { name: 'title', required: true, hint: 'one line' },
        { name: 'notes', required: 'unknown' },
      ],
    },
    consumes: { env: [{ var: 'TODO_HOME' }], reads: [{ path: 'db.sqlite' }] },
    produces: {
      statuses: [
        { status: '201', when: 'the todo was created' },
        { status: 'unknown', when: 'the store is unwritable and no path is declared' },
      ],
      body: [{ marker: '"id"' }, { marker: '"error"', when: 'the title is missing' }],
      writes: [],
    },
  },
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
        surface: 'cli',
        command: {
          ...CONTRACT.command,
          io: {
            ...CONTRACT.command.io,
            consumes: {
              ...CONTRACT.command.io!.consumes,
              reads: [
                { path: '~/.tasks.json', when: 'the store the listing renders' },
                { path: '<repo>/.tasks/config.json' },
              ],
            },
          },
        },
      },
    },
    { ...MAPPED.interfaces[1], id: 'cli/tasks-purge', title: 'tasks purge', contract: PURGE_READS_NOTHING },
  ],
};

const WITH_CONTRACT: GuardInterfacesView = {
  ...MAPPED,
  interfaces: [
    { ...MAPPED.interfaces[0], contract: CONTRACT },
    // The shape a degraded derivation writes: the surface's shape, no contract.
    MAPPED.interfaces[1],
    { ...MAPPED.interfaces[1], id: 'cli/tasks-purge', title: 'tasks purge', contract: PURGE_CONTRACT },
  ],
};

/** An api entry carrying the union's other member — the pane must dispatch. */
const WITH_OPERATION: GuardInterfacesView = {
  ...API_MAPPED,
  interfaces: [{ ...API_MAPPED.interfaces[0], contract: OPERATION }, API_MAPPED.interfaces[1]],
};

const UNMAPPED: GuardInterfacesView = {
  mapped: false,
  generatedAt: null,
  recipeFingerprint: null,
  interfaces: [],
  surfaces: SURFACES.map((s) => ({ ...s, interfaces: 0, resources: 0, detected: false })),
  totals: { interfaces: 0, detectedSurfaces: 0, grounded: 0, ungrounded: 0 },
};

// ---------------------------------------------------------------------------
// The WEB fixture: a registry with real nesting, named states with descriptions,
// readables on the place, and `apiEffects` pointing at the api entries beside it.
// ---------------------------------------------------------------------------

const WEB_VIEW: GuardInterfacesView = {
  ...MAPPED,
  interfaces: [
    {
      id: 'web/open-dashboard-home',
      type: 'web',
      title: 'Open the dashboard home',
      entry: { method: 'GET', path: '/' },
      steps: [{ kind: 'navigate', route: '/' }],
      to: 'repo-report',
      fingerprint: 'sha256:home',
      flows: [],
      scenarioIds: [],
    },
    {
      id: 'web/silence-rule-from-violation-card',
      type: 'web',
      title: 'Silence a noisy rule from a violation card',
      entry: { method: 'GET', path: '/repos/{repoId}' },
      steps: [
        { kind: 'activate', target: 'button "More actions"' },
        { kind: 'activate', target: 'menuitem "Disable rule for this repo"' },
      ],
      at: 'violations-list',
      startingState: 'repo-report-open',
      endState: 'rule-silenced',
      apiEffects: ['api/patch-rules', 'api/gone'],
      fingerprint: 'sha256:silence',
      flows: [usedBy(FLOW_ID, FLOW_TITLE)],
      scenarioIds: [],
    },
    {
      id: 'web/open-rules-panel',
      type: 'web',
      title: 'Open the repository’s Rules panel',
      entry: { method: 'GET', path: '/repos/{repoId}' },
      steps: [{ kind: 'activate', target: 'button "Browse Rules"' }],
      at: 'violations-list',
      to: 'rules-dialog',
      apiEffects: [],
      fingerprint: 'sha256:open-rules',
      flows: [],
      scenarioIds: [],
    },
    {
      id: 'web/filter-violations-by-category',
      type: 'web',
      title: 'Narrow the violation list to one category',
      entry: { method: 'GET', path: '/repos/{repoId}' },
      steps: [{ kind: 'activate', target: 'button "{category}"' }],
      at: 'violations-list',
      endState: 'violations-filtered-by-category',
      fingerprint: 'sha256:filter',
      flows: [],
      scenarioIds: [],
    },
    {
      id: 'api/patch-rules',
      type: 'api',
      title: 'PATCH /api/repos/{id}/rules/{ruleKey}',
      entry: { method: 'PATCH', path: '/api/repos/{id}/rules/{ruleKey}' },
      steps: [{ kind: 'request', method: 'PATCH', path: '/api/repos/{id}/rules/{ruleKey}' }],
      fingerprint: 'sha256:patch-rules',
      flows: [],
      scenarioIds: [],
    },
  ],
  resources: {
    web: [
      {
        id: 'repo-report',
        kind: 'screen',
        title: 'the repository report',
        address: '/repos/{repoId}',
        description: 'The repository page’s Home tab: the latest analysis report.',
      },
      {
        id: 'violations-list',
        kind: 'panel',
        title: 'the violation list',
        of: 'repo-report',
        description: 'The report’s right half: the filters and the violation cards.',
        readables: {
          markers: [{ marker: 'Filtered by:', when: 'any filter is active' }],
          controls: [{ control: { role: 'button', name: 'More actions' }, states: ['expanded'] }],
          rows: [
            {
              item: 'listitem',
              within: { role: 'list', name: 'Violations' },
              template: '<ruleName> · <severity>',
              slots: [
                { name: 'ruleName', kind: 'text' },
                { name: 'severity', kind: 'enum', values: ['critical', 'high'] },
              ],
            },
          ],
        },
      },
      { id: 'rules-dialog', kind: 'dialog', title: 'the Rules dialog', of: 'repo-report' },
      // A screen no task acts on — counted out under the rows, never listed.
      { id: 'guard-section', kind: 'screen', title: 'the Spec Guard section' },
    ],
  },
  states: {
    web: [
      { id: 'repo-report-open', description: 'The repository report is open on its Home tab.' },
      {
        id: 'rule-silenced',
        description: 'A rule is disabled for the repository and its cards have left the list.',
      },
    ],
  },
  surfaces: SURFACES.map((s) =>
    s.surface === 'web' ? { ...s, interfaces: 4, resources: 3, detected: true, source: 'tree' as const } : s,
  ),
  totals: { interfaces: 5, detectedSurfaces: 2, grounded: 1, ungrounded: 4 },
};

afterEach(() => vi.unstubAllGlobals());

/**
 * The tab exactly as RepoPage wires it: one hook feeding panel + pane, the place
 * tab set and the expanded MEMBER shared by both, the surface narrowing and the
 * per-surface RECIPE toggle owned above both (the opener is in the panel, the
 * body is in the pane).
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
  const [member, setMember] = useGuardInterfaceMember();
  const loc = useLocation();
  const [surfaces, setSurfaces] = useState<string[]>([]);
  const [recipeSurface, setRecipeSurface] = useState<GuardDriverId | null>(null);
  return (
    <div>
      <span data-testid="search">{loc.search}</span>
      <div data-testid="panel">
        <GuardInterfacesPanel
          interfaces={interfaces.view?.interfaces ?? []}
          {...(interfaces.view?.resources ? { resources: interfaces.view.resources } : {})}
          loading={interfaces.loading}
          error={interfaces.error}
          activeId={recipeSurface ? null : tabs.activeId}
          activeMemberId={member}
          surfaces={surfaces}
          onSurfaces={setSurfaces}
          hasRecipe={recipe != null}
          recipeSurface={recipeSurface}
          onToggleRecipe={(surface) => setRecipeSurface((open) => (open === surface ? null : surface))}
          onOpen={(place, pinned, opened) => {
            setRecipeSurface(null);
            setMember(opened ?? null);
            tabs.open(place, pinned);
          }}
        />
      </div>
      <GuardInterfacesPane repoId="r"
        view={interfaces.view}
        loading={interfaces.loading}
        error={interfaces.error}
        tabs={tabs}
        member={member}
        onMember={setMember}
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
  const [member, setMember] = useGuardInterfaceMember();
  const loc = useLocation();
  return (
    <>
      <span data-testid="search">{loc.search}</span>
      <GuardInterfacesPane repoId="r"
        view={view}
        loading={false}
        error={null}
        tabs={tabs}
        member={member}
        onMember={setMember}
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

/** A row's own words: its title/signature, without the tally beside it. */
const rowLabel = (el: HTMLElement) =>
  el.querySelector<HTMLElement>('.truncate')?.textContent ?? el.textContent ?? '';

/**
 * The catalog panel in render order: every group header as `# label`, interleaved
 * with the row labels between them — the one reading that shows WHAT nests under WHAT.
 */
const catalogOutline = () =>
  Array.from(
    screen
      .getByRole('list', { name: 'Interface catalog' })
      .querySelectorAll<HTMLElement>('.sticky, [role="listitem"]'),
  ).map((el) =>
    el.getAttribute('role') === 'listitem'
      ? rowLabel(el)
      : `# ${el.querySelector('span')?.textContent ?? ''}`,
  );

/** A place row of the panel, by the title it reads under. */
const placeRow = (title: string) =>
  within(screen.getByTestId('panel')).getByText(title).closest('[role="listitem"]') as HTMLElement;

describe('Interfaces tab — the surfaces are the catalog’s, not a banner’s', () => {
  it('carries no detected-surface banner at all — the surface groups are that reading', () => {
    renderPane(CLI_AND_WEB);
    expect(screen.queryByText('Detected surfaces')).not.toBeInTheDocument();
    expect(screen.queryByText(/CLI · runnable ✓/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Web · Needs web driver ⚠/)).not.toBeInTheDocument();
  });

  it('says what an empty catalog means — and offers no action for it', () => {
    renderPane(UNMAPPED);
    expect(screen.getByText('No interfaces mapped yet')).toBeInTheDocument();
    // The Map trigger is gone: interface derivation is the engine's, not a button.
    expect(screen.queryByText(/free, no LLM/)).toBeNull();
    expect(screen.queryByRole('button', { name: /^Map/ })).toBeNull();
  });

  it('asks for a ROW of the catalog, not an interface, when nothing is open', () => {
    renderPane(MAPPED);
    expect(screen.getByText('Select a place')).toBeInTheDocument();
  });
});

/**
 * THE PANEL'S ROWS — one flat row per thing a reader can open, in the shape the
 * surface reads as: a screen, an operation, a command. Nothing nests, nothing
 * expands, and the tasks a screens surface has no place for read as SIGNATURES
 * under a quiet header of their own.
 */
describe('Interfaces tab — the catalog rows', () => {
  const stub = (view: GuardInterfacesView) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => (String(url).includes('/guard/interfaces') ? json(view) : json({}))),
    );

  it('lists one row per COMMAND on cli — no group rows, nothing nested', async () => {
    stub(MAPPED);
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });
    // The registry's two command GROUPS are a prefix the rows already spell.
    expect(catalogOutline()).toEqual([
      'CLI recipe',
      '# CLI',
      'tasks add',
      'tasks list',
      'tasks done',
      'tasks purge',
      'tasks telemetry off',
    ]);
    expect(screen.getByText('5 commands')).toBeInTheDocument();
  });

  it('lists one row per SCREEN on web, tallying its parts with it', async () => {
    stub(WEB_VIEW);
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });
    // `open-dashboard-home` acts at no place — it is what OPENS the surface, and
    // every such member stands behind ONE Entries row, not a group of its own.
    // The violation list and the Rules dialog are PARTS of the report, not rows.
    // The api entry is its own operation row, endpoint or no endpoint.
    expect(catalogOutline()).toEqual([
      'API recipe',
      'Web recipe',
      '# API',
      '/api/repos/{id}/rules/{ruleKey}',
      '# Web',
      'Ways in',
      'the repository report',
    ]);
    // Nothing is at the screen itself; all three tasks are on its violation list.
    expect(placeRow('the repository report')).toHaveTextContent(/3$/);
  });

  it('hides a screen with nothing to do, and counts it out under the rows', async () => {
    stub(WEB_VIEW);
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });
    expect(screen.queryByText('the Spec Guard section')).toBeNull();
    expect(screen.getByText('1 screen with nothing to do hidden')).toBeInTheDocument();
  });

  it('lists one row per OPERATION on api, the method leading the path in its own colour', async () => {
    stub(API_MAPPED);
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });
    // Two operations of ONE endpoint, adjacent, the read before the write.
    expect(catalogOutline()).toEqual(['API recipe', '# API', '/todos/{id}', '/todos/{id}']);
    const rows = within(screen.getByTestId('panel'))
      .getAllByText('/todos/{id}')
      .map((el) => el.closest('[role="listitem"]') as HTMLElement);
    expect(rows.map((row) => within(row).getByText(/^(GET|PATCH)$/).textContent)).toEqual([
      'GET',
      'PATCH',
    ]);
    // Colour is how a verb survives a skim of forty rows — a token, not a chip.
    expect(within(rows[0]!).getByText('GET').className).toContain('oklch');

    // The NOUN is not a row at all; an endpoint no operation serves is counted
    // out, because it never had a row to drop.
    expect(screen.queryByText('/todos')).toBeNull();
    expect(screen.queryByText('/lists')).toBeNull();
    expect(screen.getByText('1 endpoint with no operations hidden')).toBeInTheDocument();
    expect(screen.getByText('2 operations across 1 endpoint')).toBeInTheDocument();
  });

  it('finds a screen by what is ON it, not only by its own words', async () => {
    const user = userEvent.setup();
    stub(WEB_VIEW);
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });

    await user.type(screen.getByLabelText('Search interfaces'), 'silence-rule');
    // The task is on a panel of the report, so the report is the answer.
    expect(catalogOutline()).toEqual(['Web recipe', '# Web', 'the repository report']);
  });

  it('finds the ENTRIES row by a member it stands for — its own label names none of them', async () => {
    const user = userEvent.setup();
    stub(WEB_VIEW);
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });

    // One row now stands for every placeless member, so it has to answer for all
    // of them: searching a task by name must not lose the row that opens onto it.
    await user.type(screen.getByLabelText('Search interfaces'), 'dashboard home');
    expect(catalogOutline()).toEqual(['Web recipe', '# Web', 'Ways in']);
  });

  it('opens a row into the URL, and pins it on double click', async () => {
    const user = userEvent.setup();
    stub(MAPPED);
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });

    await user.click(within(screen.getByTestId('panel')).getByText('tasks list'));
    // Ids are AREA-scoped, so the address carries the surface with it.
    expect(search()).toContain('gplace=cli%3Atasks-list');

    await user.dblClick(within(screen.getByTestId('panel')).getByText('tasks add'));
    expect(search()).toContain('gplace=cli%3Atasks-add');
    // The tab is addressed by the selection id and LABELLED by the row's title.
    expect(screen.getByLabelText('Close cli:tasks-add')).toBeInTheDocument();
  });
});

/**
 * THE SCREEN PAGE — one top-level place, AGGREGATED over its panels and dialogs,
 * as the classic pane header over ONE section: the CONTRACT, which is two tables.
 */
describe('Interfaces tab — a screen and its contract', () => {
  const openReport = () => renderPane(WEB_VIEW, '/repos/r?tab=interfaces&gplace=web%3Arepo-report');

  /** The header's own column set, in order — the table's contract with a reader. */
  const headers = (table: HTMLElement) =>
    within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent);

  it('heads the pane in the classic idiom: surface, kind, place id, then route and mapping', () => {
    openReport();
    expect(screen.getByText('Web')).toBeInTheDocument();
    expect(screen.getByText('screen')).toBeInTheDocument();
    expect(screen.getByText('repo-report')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'the repository report' })).toBeInTheDocument();
    // WHERE it is and WHEN it was read off the tree — one muted line.
    expect(screen.getByText(/^route \/repos\/\{repoId\} · mapped /)).toBeInTheDocument();
    expect(screen.getByText(/the latest analysis report/)).toBeInTheDocument();
  });

  it('drops the "on this screen" chip row — the Where column carries the parts now', () => {
    openReport();
    expect(screen.queryByText('On this screen')).toBeNull();
  });

  it('lists every action across the screen in ONE table, the part as a column', () => {
    openReport();
    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('Actions · 3')).toBeInTheDocument();
    expect(headers(screen.getAllByRole('table')[0]!)).toEqual([
      'Action',
      'Where',
      'Needs',
      'Leaves',
      'Flows',
    ]);

    const row = screen.getByText('Silence a noisy rule from a violation card').closest('tr')!;
    // The elements a task touches read in its SEQUENCE, one click down — never as
    // a second line under every title.
    expect(row.textContent).not.toContain('button "More actions"');
    expect(within(row).getByText('violation list')).toBeInTheDocument();
    expect(within(row).getByText('repo-report-open')).toBeInTheDocument();
    expect(within(row).getByText('rule-silenced')).toBeInTheDocument();
    // One count: the flows that use it. What the click CALLS is implementation
    // traffic, and is not on this page at all.
    expect(within(row).getByText('1')).toBeInTheDocument();
    // A part with no tasks contributes no heading and no row.
    expect(screen.queryByText('Rules dialog')).toBeNull();
  });

  it('renders an unestablished world as an em dash, and a `to` as its destination', () => {
    openReport();
    const filter = screen.getByText('Narrow the violation list to one category').closest('tr')!;
    // Nothing established is an em dash — never an invented "none".
    expect(within(filter).getAllByText('—').length).toBeGreaterThan(0);
    expect(within(filter).getByText('violations-filtered-by-category')).toBeInTheDocument();

    const opens = screen.getByText('Open the repository’s Rules panel').closest('tr')!;
    // A task that hands you a place ON THIS SCREEN goes nowhere a click could
    // follow — the destination is plain text, because a non-link must not dress
    // as one. Only a destination on ANOTHER screen is a link.
    expect(within(opens).getByText('→ the Rules dialog')).toBeInTheDocument();
    expect(within(opens).queryByRole('button', { name: '→ the Rules dialog' })).toBeNull();
  });

  it('opens an action IN PLACE — its identity, sequence, calls and the world it leaves', async () => {
    const user = userEvent.setup();
    openReport();
    // Neither is on the collapsed row: an id and a fingerprint are what you read
    // ABOUT an action, not how you pick one out of a table. And it is the ID —
    // the runner has no task verb, so no minted `camelCase()` pretends otherwise.
    expect(screen.queryByText('web/silence-rule-from-violation-card')).toBeNull();

    await user.click(screen.getByText('Silence a noisy rule from a violation card'));
    expect(screen.getByText('web/silence-rule-from-violation-card')).toBeInTheDocument();
    expect(screen.getByText('silence')).toBeInTheDocument();
    expect(screen.getByText('Sequence')).toBeInTheDocument();
    // The elements it touches are HERE, in the sequence — the one place they read.
    expect(screen.getByText('button "More actions"')).toBeInTheDocument();
    expect(screen.getByText('Used by flows')).toBeInTheDocument();
  });

  it('opens only one action at a time', async () => {
    const user = userEvent.setup();
    openReport();
    await user.click(screen.getByText('Silence a noisy rule from a violation card'));
    expect(screen.getByText('Sequence')).toBeInTheDocument();

    await user.click(screen.getByText('Narrow the violation list to one category'));
    expect(screen.getByText('web/filter-violations-by-category')).toBeInTheDocument();
    // The first action's own sequence is gone with it — one body, one action.
    expect(screen.queryByText('button "More actions"')).not.toBeInTheDocument();
  });

  it('lists everything THE PAGE SHOWS, each row located the way a step locates it', () => {
    openReport();
    expect(screen.getByText('The page shows · 3')).toBeInTheDocument();
    expect(headers(screen.getAllByRole('table')[1]!)).toEqual([
      'Kind',
      'What',
      'Locator',
      'When',
      'Where',
    ]);

    // The KIND reads as what the thing IS — text, rows, element, control — not as
    // the catalog's own verbs, which read as noise down a column.
    const marker = screen.getByText('“Filtered by:”').closest('tr')!;
    expect(within(marker).getByText('text')).toBeInTheDocument();
    expect(within(marker).getByText('any filter is active')).toBeInTheDocument();
    // No `within` — the marker is read off the whole place, and the column says so.
    expect(within(marker).getByText('—')).toBeInTheDocument();

    const rows = screen.getByText('<ruleName> · <severity>').closest('tr')!;
    expect(within(rows).getByText('rows')).toBeInTheDocument();
    expect(within(rows).getByText('listitem · in list “Violations”')).toBeInTheDocument();

    const control = screen.getByText('exposes expanded').closest('tr')!;
    expect(within(control).getByText('control')).toBeInTheDocument();
    expect(within(control).getByText('button “More actions”')).toBeInTheDocument();
    // The Rules dialog establishes no readables, so it contributes no row — and
    // no "none" is invented on its behalf.
    expect(screen.getAllByText('violation list')).toHaveLength(6);
  });

  it('says nothing about what the page shows where the catalog established nothing', () => {
    renderPane(WEB_VIEW, '/repos/r?tab=interfaces&gplace=web%3Aguard-section');
    expect(screen.queryByText(/^The page shows/)).toBeNull();
    // Zero actions IS established — it is what hides the row from the panel.
    expect(screen.getByText('Actions · 0')).toBeInTheDocument();
    expect(screen.getByText('Nothing in the catalog acts on this screen.')).toBeInTheDocument();
  });

  it('gives a surface’s loose ENTRIES a page of their own, leading where they lead', async () => {
    const user = userEvent.setup();
    renderPane(WEB_VIEW, '/repos/r?tab=interfaces&gplace=web%3A');
    expect(screen.getByRole('heading', { name: 'Web ways in' })).toBeInTheDocument();
    expect(screen.getByText('Open the dashboard home')).toBeInTheDocument();
    // An entry has no place, so there is nothing to assert on beside it.
    expect(screen.queryByText(/^Get · /)).toBeNull();

    const row = screen.getByText('Open the dashboard home').closest('[role="button"]')!;
    await user.click(within(row).getByRole('button', { name: 'the repository report' }));
    await waitFor(() => expect(search()).toContain('gplace=web%3Arepo-report'));
  });
});

/**
 * THE OPERATION PAGE — one api interface, opened DIRECTLY. The endpoint is not a
 * page to pass through: it is one line naming the noun and the operations that
 * share it, each a chip that jumps.
 */
describe('Interfaces tab — an operation, opened directly', () => {
  const openGet = (view = API_MAPPED) =>
    renderPane(view, '/repos/r?tab=interfaces&gplace=api%3Aget-todos-id');

  it('heads the pane with the surface, the coloured method and the path — no list in between', () => {
    openGet();
    expect(screen.getByText('API')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '/todos/{id}' })).toBeInTheDocument();
    expect(screen.getByText('GET').className).toContain('oklch');
    // There is no operations list to pick from any more: the row WAS the pick.
    expect(screen.queryByText(/^Operations · /)).toBeNull();
  });

  it('names the endpoint and its siblings as chips that jump', async () => {
    const user = userEvent.setup();
    openGet();
    // The noun is mono inside the sentence, so the line is one span of three nodes.
    expect(
      screen.getByText((_, el) => el?.tagName === 'SPAN' && el.textContent === 'endpoint /todos · also:'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'PATCH /todos/{id}' }));
    await waitFor(() => expect(search()).toContain('gplace=api%3Apatch-todos-id'));
    // …and the sibling's page names the one we came from, the same way.
    expect(await screen.findByRole('button', { name: 'GET /todos/{id}' })).toBeInTheDocument();
  });

  it('offers no endpoint line for an operation the registry names no noun for', () => {
    renderPane(WEB_VIEW, '/repos/r?tab=interfaces&gplace=api%3Apatch-rules');
    expect(
      screen.getByRole('heading', { name: '/api/repos/{id}/rules/{ruleKey}' }),
    ).toBeInTheDocument();
    // Two paths are not one endpoint just because nobody grouped them.
    expect(screen.queryByText(/^endpoint /)).toBeNull();
  });

  it('opens straight into the summary and the HTTP contract', () => {
    openGet(WITH_OPERATION);
    // The contract's one-line SUMMARY heads the page; its longer `description`
    // is the contract body's, below.
    expect(screen.getByText('Create a todo.')).toBeInTheDocument();
    expect(screen.getByText('Appends the todo and answers the created row.')).toBeInTheDocument();
    expect(screen.getByText('Request')).toBeInTheDocument();
    expect(screen.getByText('Response statuses')).toBeInTheDocument();
    expect(screen.getByText('Used by flows')).toBeInTheDocument();
  });
});

/** THE COMMAND PAGE — one cli interface, whole. A row IS the command. */
describe('Interfaces tab — a command', () => {
  it('is the command’s own page: no member list, the contract straight away', async () => {
    renderPane(WITH_CONTRACT, '/repos/r?tab=interfaces&gplace=cli%3Atasks-add');
    const header = within(screen.getByRole('heading', { name: 'tasks add' }).parentElement!);
    expect(header.getByText('CLI')).toBeInTheDocument();
    expect(header.getByText('command')).toBeInTheDocument();
    expect(await screen.findByText('Grammar')).toBeInTheDocument();
    // Nothing to expand: the page is the one interface.
    expect(screen.queryByText('add([--json])')).toBeNull();
    expect(screen.getByText('Used by flows')).toBeInTheDocument();
  });

  it('says so when the catalog has no row for the selection any more', () => {
    renderPane(WITH_CONTRACT, '/repos/r?tab=interfaces&gplace=cli%3Agone');
    expect(screen.getByText('Not in the catalog')).toBeInTheDocument();
  });
});

/**
 * AN EXPANDED ACTION'S OWN FACTS — the gap this redesign closed. A web task's
 * contract is not a separate artifact: it is the entry's own steps, the world it
 * leaves, and the api calls its clicks make. Before this the pane dead-ended at
 * "No contract derived" and `apiEffects` was rendered nowhere.
 *
 * The world it NEEDS is not repeated here: it is the Needs column of the row
 * that opened, two lines up, and the page reads once.
 */
describe('Interfaces tab — an expanded action’s own facts', () => {
  const openTask = (id = 'web%2Fsilence-rule-from-violation-card') =>
    renderPane(WEB_VIEW, `/repos/r?tab=interfaces&ginterface=${id}`);

  it('never reaches the "no contract derived" card', async () => {
    openTask();
    expect(await screen.findByText('Sequence')).toBeInTheDocument();
    expect(screen.queryByText('No contract derived')).not.toBeInTheDocument();
  });

  it('renders the steps in the order they run, each in its own step kind', async () => {
    openTask();
    const sequence = within((await screen.findByText('Sequence')).parentElement as HTMLElement);
    expect(sequence.getAllByText(/^(activate|input|navigate)$/).map((el) => el.textContent)).toEqual([
      'activate',
      'activate',
    ]);
    expect(sequence.getByText('button "More actions"')).toBeInTheDocument();
    expect(sequence.getByText('menuitem "Disable rule for this repo"')).toBeInTheDocument();
  });

  it('names the world it LEAVES with the registry’s own line — and repeats no Needs', async () => {
    openTask();
    expect(await screen.findByText('Sequence')).toBeInTheDocument();
    expect(
      screen.getByText('A rule is disabled for the repository and its cards have left the list.'),
    ).toBeInTheDocument();
    // The starting world is the row's Needs column; its gloss belongs to the
    // screen it is assumed on, not to this block.
    expect(screen.queryByText('The repository report is open on its Home tab.')).toBeNull();
    // The id is the fact — mono, matched by equality; the description is the gloss.
    expect(screen.getByText('repo-report-open').className).toMatch(/font-mono/);
  });

  it('says nothing about what the click CALLS — implementation traffic is not this page', async () => {
    openTask();
    expect(await screen.findByText('Sequence')).toBeInTheDocument();
    // `apiEffects` stays in the catalog and the raw view; the tab renders what a
    // reader DRIVES, so neither the minted call name nor its endpoint appears.
    expect(screen.queryByText('Calls')).toBeNull();
    expect(screen.queryByText('rules.update()')).toBeNull();
    expect(screen.queryByText('PATCH /api/repos/{id}/rules/{ruleKey}')).toBeNull();
    expect(screen.queryByText('api/gone')).toBeNull();
  });

  it('leaves what the screen SHOWS to the screen — the page reads once', async () => {
    openTask();
    expect(await screen.findByText('Sequence')).toBeInTheDocument();
    // The readables belong to the screen, in their own table, and the open
    // action's facts add no second copy of them.
    expect(screen.getAllByText('The page shows · 3')).toHaveLength(1);
    expect(screen.getAllByText('exposes expanded')).toHaveLength(1);
  });
});

/**
 * CROSS-NAVIGATION. Other surfaces address an INTERFACE (`?ginterface=`), and the
 * pane's subject is a ROW — so the pane resolves the one to the other: a task on
 * a panel opens the SCREEN that panel is part of, with that member expanded.
 */
describe('Interfaces tab — cross-navigation lands on the member', () => {
  it('resolves an interface id to the SCREEN that owns it, and expands the member', async () => {
    renderPane(WEB_VIEW, '/repos/r?tab=interfaces&ginterface=web%2Fsilence-rule-from-violation-card');
    // The screen is the subject — the violation list is a part of it, not a row…
    expect(await screen.findByRole('heading', { name: 'the repository report' })).toBeInTheDocument();
    // …and the member the jump named is the one that is open.
    expect(screen.getByText('Sequence')).toBeInTheDocument();
    await waitFor(() => expect(search()).toContain('gplace=web%3Arepo-report'));
    // The inbound address is CONSUMED by the selection it produced.
    expect(search()).not.toContain('ginterface');
  });

  it('lands a placeless task on its surface’s entries', async () => {
    renderPane(WEB_VIEW, '/repos/r?tab=interfaces&ginterface=web%2Fopen-dashboard-home');
    expect(await screen.findByRole('heading', { name: 'Web ways in' })).toBeInTheDocument();
    await waitFor(() => expect(search()).toContain('gplace=web%3A'));
  });

  it('still reads the retired ?gjourney alias', async () => {
    renderPane(WEB_VIEW, '/repos/r?tab=interfaces&gjourney=web%2Fopen-rules-panel');
    expect(await screen.findByRole('heading', { name: 'the repository report' })).toBeInTheDocument();
    expect(screen.getByText('web/open-rules-panel')).toBeInTheDocument();
  });

  it('resolves an OPERATION to itself — it is already its own row', async () => {
    renderPane(API_MAPPED, '/repos/r?tab=interfaces&ginterface=api%2Fpatch-todos-id');
    expect(await screen.findByRole('heading', { name: '/todos/{id}' })).toBeInTheDocument();
    await waitFor(() => expect(search()).toContain('gplace=api%3Apatch-todos-id'));
    expect(search()).not.toContain('ginterface');
  });

  it('closes for good — a still-expanded member is not a second arrival', async () => {
    const user = userEvent.setup();
    renderPane(WEB_VIEW, '/repos/r?tab=interfaces&ginterface=web%2Fsilence-rule-from-violation-card');
    await screen.findByRole('heading', { name: 'the repository report' });

    await user.click(screen.getByLabelText('Close web:repo-report'));
    expect(screen.getByText('Select a place')).toBeInTheDocument();
    // …and it stays closed: the place must not re-resolve itself off the member
    // that was open in it.
    await waitFor(() => expect(search()).not.toContain('gplace'));
    expect(screen.getByText('Select a place')).toBeInTheDocument();
  });

  it('scrolls the deep-linked MEMBER into view — the cross-navigation rule', async () => {
    const scrolled: Element[] = [];
    const spy = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(function (this: Element) {
        scrolled.push(this);
      });
    renderPane(WEB_VIEW, '/repos/r?tab=interfaces&ginterface=web%2Ffilter-violations-by-category');
    await screen.findByRole('heading', { name: 'the repository report' });
    await waitFor(() =>
      expect(
        scrolled.some((el) => el.textContent?.includes('Narrow the violation list to one category')),
      ).toBe(true),
    );
    spy.mockRestore();
  });
});

describe('Interfaces tab — the mapped catalog', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => (String(url).includes('/guard/interfaces') ? json(MAPPED) : json({}))),
    );
  });

  it('carries the reverse index onto the flows, on every action row', async () => {
    renderPane(WEB_VIEW, '/repos/r?tab=interfaces&gplace=web%3Arepo-report');
    // One of the three tasks on this screen is used by a flow; nothing
    // references the other two — the candidate spec gaps.
    const flows = Array.from(
      screen.getAllByRole('table')[0]!.querySelectorAll<HTMLElement>('tbody tr td:last-child'),
    ).map((td) => td.textContent);
    expect(flows).toEqual(['1', '0', '0']);
  });

  it('links the flows that use an open member', async () => {
    const user = userEvent.setup();
    const onOpenFlow = vi.fn();
    renderTab('/repos/r?tab=interfaces&gplace=cli%3Atasks-add', onOpenFlow);

    expect(await screen.findByText('Used by flows')).toBeInTheDocument();
    // The flow reads by TITLE, not by its engine id — and wears the SAME status
    // chip the Flows list wears (one vocabulary, one chip component).
    await user.click(screen.getByRole('button', { name: new RegExp(FLOW_TITLE) }));
    expect(onOpenFlow).toHaveBeenCalledWith(FLOW_ID);
  });

  it('an interface used only by a BLOCKED flow reads as used, and says what it needs', async () => {
    const onOpenFlow = vi.fn();
    const user = userEvent.setup();
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

  // An interface's truth is its entry in guard/interfaces.json, so an OPEN MEMBER
  // offers the SAME two readings every artifact-backed entity does — and no third.
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
    // A SCREEN is many entries, so with no action open there is no single
    // artifact to read, and no switch is offered.
    renderPane(WEB_VIEW, '/repos/r?tab=interfaces&gplace=web%3Arepo-report');
    expect(screen.getByText('Actions · 3')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'View mode' })).toBeNull();

    cleanup();
    // A COMMAND, by contrast, IS one entry — its page carries the switch with
    // nothing expanded at all.
    renderTab('/repos/r?tab=interfaces&gplace=cli%3Atasks-add');
    const modes = await screen.findByRole('group', { name: 'View mode' });
    expect(within(modes).getAllByRole('button').map((b) => b.textContent)).toEqual(['View', 'JSON']);
    expect(within(modes).getByRole('button', { name: 'View' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByLabelText('interface source')).not.toBeInTheDocument();

    await user.click(within(modes).getByRole('button', { name: 'JSON' }));
    await waitFor(() => expect(screen.getByLabelText('interface source')).toHaveTextContent('sha256:j1'));
    // The stored file REPLACES the page — never two readings at once.
    expect(screen.queryByText('Used by flows')).not.toBeInTheDocument();

    await user.click(within(modes).getByRole('button', { name: 'View' }));
    expect(await screen.findByText('Used by flows')).toBeInTheDocument();
  });

  it('says when an operation is documented but unrouted', async () => {
    renderPane(API_MAPPED, '/repos/r?tab=interfaces&ginterface=api%2Fpatch-todos-id');

    expect(await screen.findByRole('heading', { name: '/todos/{id}' })).toBeInTheDocument();
    // The specOnly cross-check reads as a plain sentence, and the zero-references
    // line must NOT claim the spec never mentions it — the spec is where it's from.
    expect(screen.getByText(/no code route serves it/)).toBeInTheDocument();
    expect(screen.getByText('No flow uses this interface yet.')).toBeInTheDocument();
    expect(screen.queryByText(/the spec never mentions this code path/)).not.toBeInTheDocument();
  });

  it('an api interface that code serves carries no unrouted caution', async () => {
    renderPane(API_MAPPED, '/repos/r?tab=interfaces&ginterface=api%2Fget-todos-id');
    expect(await screen.findByRole('heading', { name: '/todos/{id}' })).toBeInTheDocument();
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

  it('scrolls a deep-linked PLACE row into view — the cross-navigation rule', async () => {
    const scrolled: Element[] = [];
    const spy = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(function (this: Element) {
        scrolled.push(this);
      });
    renderTab('/repos/r?tab=interfaces&gplace=cli%3Atelemetry');
    await screen.findByRole('list', { name: 'Interface catalog' });
    // The scroll is a passive effect on the commit that renders the rows, so the
    // list being queryable does NOT mean it has run yet — poll for the effect
    // rather than the DOM it fires alongside.
    await waitFor(() =>
      expect(scrolled.some((el) => el.textContent?.includes('tasks telemetry off'))).toBe(true),
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

  // Nothing selected IS this pane — "pick a place" — so the strip never offers an
  // Overview chip to go "back" to it.
  it('carries NO Overview entry in its tab strip, and names its tabs by PLACE', async () => {
    const user = userEvent.setup();
    renderTab();
    expect(await screen.findByText('Select a place')).toBeInTheDocument();
    expect(screen.queryByText('Overview')).toBeNull();

    await user.click(within(screen.getByTestId('panel')).getByText('tasks add'));
    // The tab wears the row's own title; only its ADDRESS is the selection id.
    expect(screen.getByLabelText('Close cli:tasks-add')).toBeInTheDocument();
    expect(screen.queryByText('Overview')).toBeNull();

    await user.click(screen.getByLabelText('Close cli:tasks-add'));
    expect(await screen.findByText('Select a place')).toBeInTheDocument();
  });
});

/**
 * THE SURFACE FILTER — the one filter idiom over the catalog: a count chip per
 * surface the catalog has, counted by INTERFACES (how much code is on it, which
 * is what a reader is choosing between). The surface GROUPS survive the
 * narrowing; filtering to one surface just leaves that surface's rows standing.
 */
describe('Interfaces tab — the surface filter', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => (String(url).includes('/guard/interfaces') ? json(CLI_AND_WEB) : json({}))),
    );
  });

  const bar = () => screen.getByRole('group', { name: 'Filter by driver' });

  it('offers a chip per surface the catalog HAS, counted by what it keeps', async () => {
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });
    expect(within(bar()).getByRole('button', { name: 'CLI 5' })).toBeInTheDocument();
    expect(within(bar()).getByRole('button', { name: 'Web 1' })).toBeInTheDocument();
    // Drivers with no code behind them are engine knowledge, not user information.
    expect(within(bar()).queryByRole('button', { name: /^API/ })).toBeNull();
    expect(within(bar()).queryByRole('button', { name: /^Desktop/ })).toBeNull();
  });

  it('narrows to the drivers clicked — multi-select, a union like the Tests filter', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });

    await user.click(within(bar()).getByRole('button', { name: 'Web 1' }));
    // The board is a screen nothing acts ON — the entry that OPENS it is the
    // surface's one row, and the board is counted out under it.
    expect(catalogOutline()).toEqual(['Web recipe', '# Web', 'Ways in']);
    expect(within(bar()).getByRole('button', { name: 'Web 1' })).toHaveAttribute('aria-pressed', 'true');

    // A second chip WIDENS the selection — never a swap: both stay pressed and
    // the list is the union of the two.
    await user.click(within(bar()).getByRole('button', { name: 'CLI 5' }));
    expect(within(bar()).getByRole('button', { name: 'Web 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(catalogOutline()).toContain('# CLI');
    expect(catalogOutline()).toContain('# Web');

    // Toggling both off restores the whole catalog.
    await user.click(within(bar()).getByRole('button', { name: 'CLI 5' }));
    await user.click(within(bar()).getByRole('button', { name: 'Web 1' }));
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
    await screen.findByRole('list', { name: 'Interface catalog' });

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
    await screen.findByRole('list', { name: 'Interface catalog' });

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
    await screen.findByRole('list', { name: 'Interface catalog' });

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
    await screen.findByRole('list', { name: 'Interface catalog' });

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
    await screen.findByRole('list', { name: 'Interface catalog' });

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
    await screen.findByRole('list', { name: 'Interface catalog' });

    await user.click(opener('API'));
    const recipe = await screen.findByRole('region', { name: 'Recipe' });
    expect(
      within(recipe).getByText('The recipe declares no preparation for this surface.'),
    ).toBeInTheDocument();
    expect(within(recipe).queryByText(/same server as the web surface/)).toBeNull();
  });

  it('picking a place navigates AWAY from the recipe — one body, one subject', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });
    await user.click(opener('CLI'));
    await screen.findByRole('region', { name: 'Recipe' });

    await user.click(within(screen.getByTestId('panel')).getByText('tasks telemetry off'));
    expect(screen.queryByRole('region', { name: 'Recipe' })).toBeNull();
    expect(opener('CLI')).toHaveAttribute('aria-pressed', 'false');
    expect(
      await screen.findByRole('heading', { name: 'tasks telemetry off' }),
    ).toBeInTheDocument();
  });

  it('reads the stored file verbatim in raw mode — the WHOLE file, lazily', async () => {
    const user = userEvent.setup();
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });
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
    await screen.findByRole('list', { name: 'Interface catalog' });
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
    await screen.findByRole('list', { name: 'Interface catalog' });
    expect(within(screen.getByTestId('panel')).queryByRole('button', { name: /recipe/i })).toBeNull();
  });
});

/**
 * WHERE THE RECIPE ROWS SIT, and what they are made of. All of them together at
 * the TOP of the panel — one per surface the catalog shows, in the catalog's own
 * surface order — and each one a ROW of the list: the same wrapper, the same
 * selected paint, the same hover as the place rows under it. Not a pill, not a
 * toolbar button, not a lead floating inside a group.
 */
describe('Interfaces tab — the recipe rows are the panel’s first rows', () => {
  const list = () => screen.getByRole('list', { name: 'Interface catalog' });
  const recipeRow = (label: string) => within(list()).getByRole('button', { name: `${label} recipe` });

  const stub = (view: GuardInterfacesView) =>
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => (String(url).includes('/guard/interfaces') ? json(view) : json({}))),
    );

  it('leads the panel with a row per surface, before any place group', async () => {
    stub(ALL_SURFACES);
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });
    expect(catalogOutline()).toEqual([
      'CLI recipe',
      'API recipe',
      'Web recipe',
      '# CLI',
      'tasks add',
      '# API',
      '/todos/{id}',
      '# Web',
      'Ways in',
    ]);
  });

  it('wears the list’s row idiom — the same class as a place row, no pill', async () => {
    const user = userEvent.setup();
    stub(ALL_SURFACES);
    renderTab();
    const row = (await within(screen.getByTestId('panel')).findByText('tasks add')).closest(
      '[role="listitem"]',
    ) as HTMLElement;

    // The row is the row: same wrapper, same paint, same hover. Not a bordered
    // pill sitting on top of the list.
    expect(recipeRow('CLI').className).toBe(row.className);
    expect(recipeRow('CLI').className).not.toMatch(/rounded/);
    expect(recipeRow('CLI').closest('[role="listitem"]')).not.toBeNull();

    // Selected, it takes the selected paint a catalog row takes — and says so as
    // a toggle, which a catalog row is not.
    await user.click(recipeRow('CLI'));
    expect(recipeRow('CLI')).toHaveAttribute('aria-pressed', 'true');
    expect(recipeRow('CLI').className).toMatch(/bg-primary\/10/);
    expect(recipeRow('Web')).toHaveAttribute('aria-pressed', 'false');
  });

  it('narrows with the list: filtered to one surface, only that surface’s recipe', async () => {
    const user = userEvent.setup();
    stub(ALL_SURFACES);
    renderTab();
    await screen.findByRole('list', { name: 'Interface catalog' });

    await user.click(
      within(screen.getByRole('group', { name: 'Filter by driver' })).getByRole('button', { name: 'API 1' }),
    );
    expect(catalogOutline()).toEqual(['API recipe', '# API', '/todos/{id}']);
  });
});

/**
 * The CONTRACT block: the CALLING INTERFACE and nothing else — the grammar of the
 * command and its input/output, the io rendered as FLAT ROWS (one fact, one line,
 * its condition after a `·`) because a fact list is not tabular data and the
 * artifact carries no prose. The page reads once: nothing here repeats the
 * member's signature or its place. The two honesty rules are asserted directly —
 * `unknown` reads as unknown, and a list the derivation never established renders
 * nothing rather than a confident "none".
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
    const command = CONTRACT.command;
    const noRows = {
      ...WITH_CONTRACT,
      interfaces: [
        {
          ...WITH_CONTRACT.interfaces[0],
          contract: {
            surface: 'cli' as const,
            command: { ...command, io: { ...command.io, produces: { output: command.io!.produces!.output } } },
          },
        },
        ...WITH_CONTRACT.interfaces.slice(1),
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
    renderPane(WITH_READS, '/repos/r?tab=interfaces&ginterface=cli%2Ftasks-purge');
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
    renderPane(WITH_CONTRACT, '/repos/r?tab=interfaces&ginterface=cli%2Ftasks-purge');
    expect(await screen.findByText('Delete every completed task.')).toBeInTheDocument();
    expect(screen.queryByText('Input and output')).not.toBeInTheDocument();
    expect(screen.queryByText('Where should tasks live?')).not.toBeInTheDocument();
  });

  it('reads once: no step list, no Contract header, no summary echo', async () => {
    openAdd();
    expect(await screen.findByText('Grammar')).toBeInTheDocument();

    // The contract does not restate what the signature row already said.
    expect(screen.queryByText('Steps')).not.toBeInTheDocument();
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

  it('never prints the command path, and offers no command nav — one entry, one command', async () => {
    // The cli member is singular now, and its page is headed by the command —
    // so the CONTRACT adds no occurrence of the path at all, and there is
    // nothing left for a nav to choose between.
    openAdd();
    expect(await screen.findByText('Grammar')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Commands' })).toBeNull();
    // Exactly two: the page's own heading, and the tab that addresses it.
    expect(screen.getAllByText('tasks add')).toHaveLength(2);

    // The SAME entry with no contract at all: the empty state is the cli/api
    // reading, and it says what is missing rather than filling anything in.
    cleanup();
    const noContract: GuardInterfacesView = {
      ...WITH_CONTRACT,
      interfaces: [
        { ...WITH_CONTRACT.interfaces[0], contract: undefined },
        ...WITH_CONTRACT.interfaces.slice(1),
      ],
    };
    renderPane(noContract, '/repos/r?tab=interfaces&ginterface=cli%2Ftasks-add');
    expect(await screen.findByText('No contract derived')).toBeInTheDocument();
  });

  it('opens the sibling command as its own member — the tree is siblings, not a nav', async () => {
    renderPane(WITH_CONTRACT, '/repos/r?tab=interfaces&ginterface=cli%2Ftasks-purge');
    expect(await screen.findByText('Delete every completed task.')).toBeInTheDocument();
    // `tasks purge` declares no positionals at all — established as none.
    const positionals = screen.getByText('Positional arguments').parentElement as HTMLElement;
    expect(within(positionals).getByText('none')).toBeInTheDocument();
  });

  it('renders an api entry as an OPERATION — request by location, statuses, body markers', async () => {
    renderPane(WITH_OPERATION, '/repos/r?tab=interfaces&ginterface=api%2Fget-todos-id');
    expect(await screen.findByText('Request')).toBeInTheDocument();

    // The three request regions, each named for where the caller puts it — no
    // "Flag" column, no positionals, no argv anywhere.
    expect(screen.getByText('Path parameters')).toBeInTheDocument();
    expect(screen.getByText('Query parameters')).toBeInTheDocument();
    expect(screen.getByText('Body fields')).toBeInTheDocument();
    expect(screen.queryByText('Grammar')).not.toBeInTheDocument();
    expect(screen.queryByText('Positional arguments')).not.toBeInTheDocument();
    const body = screen.getByText('Body fields').parentElement as HTMLElement;
    const title = within(body).getByText('title').closest('tr')!;
    expect(within(title).getByText('required')).toBeInTheDocument();
    expect(within(title).getByText('<one line>')).toBeInTheDocument();
    // A field the source reads without stating its requiredness says so.
    const notes = within(body).getByText('notes').closest('tr')!;
    expect(within(notes).getByText('unknown')).toBeInTheDocument();

    // The response side speaks HTTP: statuses, not exit codes; a body, not stdout.
    expect(screen.getByText('Response statuses')).toBeInTheDocument();
    expect(screen.getByText('Response body')).toBeInTheDocument();
    expect(screen.queryByText('Exit codes')).not.toBeInTheDocument();
    expect(screen.queryByText('Output')).not.toBeInTheDocument();
    expect(screen.queryByText('stdout')).not.toBeInTheDocument();
    const statuses = screen.getByText('Response statuses').parentElement as HTMLElement;
    expect(within(statuses).getByText('201')).toBeInTheDocument();
    // `unknown` stays first-class on this member too.
    expect(within(statuses).getByText('unknown')).toBeInTheDocument();
    // An authored EMPTY list is still a fact said out loud.
    const writes = screen.getByText('Writes').parentElement as HTMLElement;
    expect(within(writes).getByText('none')).toBeInTheDocument();
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
          surface: 'cli',
          command: { ...CONTRACT.command, sequence },
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
