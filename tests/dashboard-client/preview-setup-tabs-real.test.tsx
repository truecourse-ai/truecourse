/**
 * The setup tabs of a CONNECTED repository read the server, not the fixtures:
 * Dependencies lists the stored catalog joined with its registered instances
 * and opens one as its own page; Interfaces says, in the catalog's own words,
 * why a stored catalog is empty, and shows a failed read instead of "no match".
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('@/lib/socket', () => {
  const socket = {
    connected: false,
    on: () => socket,
    off: () => socket,
    emit: vi.fn(),
    connect: vi.fn(),
  };
  return {
    connectSocket: () => socket,
    getSocket: () => socket,
    disconnectSocket: vi.fn(),
    joinRepoRoom: vi.fn(),
    leaveRepoRoom: vi.fn(),
  };
});

import PreviewApp from '@/preview/PreviewApp';
import type { GuardDriverId, GuardInterfaceRow, GuardInterfacesView } from '@truecourse/shared';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

const realFetch = window.fetch;

const REAL = {
  id: 'filecli',
  name: 'spiderhands/filecli',
  path: 'spiderhands/filecli',
  remoteUrl: 'https://github.com/spiderhands/filecli',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** The stored dependencies view: one supplied account, one step-creatable file. */
const DEPENDENCIES = {
  catalogPath: '.truecourse/scenarios/dependencies.json',
  localPath: '.truecourse/scenarios/dependencies.local.json',
  recipePath: '.truecourse/scenarios/recipe.json',
  invalidReason: null,
  detectionAvailable: true,
  unknownLocalNames: [],
  dependencies: [
    {
      name: 'anthropic',
      class: 'supplied',
      summary: 'an Anthropic account the LLM rules run against',
      requirement: 'a key with model access',
      needs: [{ flowId: 'run-llm-rules', need: 'a key with model access' }],
      state: 'unprovided',
      registration: {
        kind: 'env',
        vars: [{ name: 'ANTHROPIC_API_KEY', description: 'the credential', secret: true }],
      },
      fields: [
        { field: 'ANTHROPIC_API_KEY', resolved: false, reason: 'no value registered for `ANTHROPIC_API_KEY`', secret: true, description: 'the credential' },
      ],
      blocks: [],
      usedBy: 1,
      inCatalog: true,
    },
    {
      name: 'target-file',
      class: 'step-creatable',
      summary: 'the file `filecli write` creates and `read` consumes',
      requirement: 'a file the scenario writes first',
      needs: [],
      state: null,
      fields: [],
      blocks: [],
      usedBy: 0,
      inCatalog: true,
    },
  ],
};

const surface = (id: GuardDriverId, label: string, source?: 'tree' | 'probes') => ({
  surface: id,
  label,
  runnable: true,
  interfaces: 0,
  resources: 0,
  detected: false,
  ...(source ? { source } : {}),
});

/** A stored catalog that came out empty: every surface read from the tree. */
const EMPTY_CATALOG = {
  mapped: true,
  generatedAt: '2026-09-03T07:28:01.856Z',
  recipeFingerprint: 'sha256:abc',
  interfaces: [],
  surfaces: [surface('cli', 'CLI', 'tree'), surface('api', 'API', 'tree'), surface('web', 'Web', 'tree')],
  totals: { interfaces: 0, detectedSurfaces: 0, grounded: 0, ungrounded: 0 },
};

/** One connected repository and what its server answers. */
function serve(options: { interfaces?: unknown; interfacesStatus?: number; recipe?: unknown } = {}) {
  const calls: string[] = [];
  window.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push(method === 'GET' ? `${url.pathname}${url.search}` : `${method} ${url.pathname}`);
    const rest = url.pathname.replace(`/api/repos/${REAL.id}/`, '');
    if (url.pathname === '/api/repos') return json([REAL]);
    if (url.pathname === '/api/llm/config') return json({ config: { provider: 'anthropic' }, providers: ['anthropic'] });
    if (rest === 'sessions/runs') return json({ runs: [] });
    if (rest === 'guard/dependencies') return json(DEPENDENCIES);
    if (rest === 'guard/interfaces') return json(options.interfaces ?? EMPTY_CATALOG, options.interfacesStatus ?? 200);
    if (rest === 'guard/scenarios') return json({ recipe: null, scenarios: [] });
    if (rest === 'guard/flows') return json({ flows: [], recipe: options.recipe ?? null });
    if (rest === 'guard/interface/raw') return json({ content: '{"id":"web/save"}', format: 'json' });
    return json({ error: `not found: ${rest}` }, 404);
  }) as unknown as typeof window.fetch;
  return calls;
}

function renderAt(path: string) {
  window.history.replaceState({}, '', path);
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/preview/*" element={<PreviewApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('the Dependencies tab of a connected repository', () => {
  it('lists supplied dependencies and hides resources created by tests', async () => {
    const calls = serve();
    renderAt(`/preview/repos/${REAL.id}/dependencies`);

    const table = await screen.findByRole('table', { name: 'Dependencies' });
    await within(table).findByText('anthropic');
    expect(within(table).queryByText('target-file')).not.toBeInTheDocument();
    expect(within(table).getByText('Credentials')).toBeInTheDocument();
    expect(within(table).getByText('Unprovided')).toBeInTheDocument();
    expect(within(table).queryByText('supplied')).not.toBeInTheDocument();
    expect(within(table).queryByText('step-creatable')).not.toBeInTheDocument();
    expect(calls).toContain(`/api/repos/${REAL.id}/guard/dependencies`);
  });

  it('opens a dependency as its own page, with the registration form', async () => {
    serve();
    renderAt(`/preview/repos/${REAL.id}/dependencies`);
    const user = userEvent.setup();

    const table = await screen.findByRole('table', { name: 'Dependencies' });
    await user.click(await within(table).findByText('anthropic'));

    // The page's form is the registration form; the page and its detail both
    // head themselves with the dependency's name.
    expect(await screen.findByLabelText('ANTHROPIC_API_KEY')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'anthropic' }).length).toBeGreaterThan(0);
  });
});

describe('the Interfaces tab of a connected repository', () => {
  it('says what setup read when the stored catalog is empty', async () => {
    serve();
    renderAt(`/preview/repos/${REAL.id}/interfaces`);

    await screen.findByText(/Setup read cli by tree, api by tree, web by tree and derived no interfaces\./);
  });

  it('shows a failed read instead of "no match"', async () => {
    serve({ interfaces: { error: 'the catalog could not be read' }, interfacesStatus: 500 });
    renderAt(`/preview/repos/${REAL.id}/interfaces`);

    await screen.findByText(/the catalog could not be read/);
    expect(screen.queryByText('No interface matches.')).toBeNull();
  });
});


function entry(id: string, title: string, type: GuardInterfaceRow['type'], extra: Partial<GuardInterfaceRow> = {}): GuardInterfaceRow {
  return { id, title, type, entry: { command: [title] }, fingerprint: 'sha256:abc',
    steps: [], flows: [], scenarioIds: [], ...extra };
}

const CATALOG: GuardInterfacesView = {
  ...EMPTY_CATALOG,
  interfaces: [
    entry('web/save', 'Save settings', 'web', { at: 'settings-dialog', origin: 'authored',
      steps: [{ kind: 'activate', target: 'Save changes' }], endState: 'saved',
      scenarioIds: ['settings.web.1'], flows: [{ flowId: 'settings', title: 'Configure settings', realized: true }] }),
    entry('web/edit', 'Edit profile', 'web', { at: 'profile', origin: 'derived',
      steps: [{ kind: 'input', target: 'Display name' }], scenarioIds: ['settings.web.2', 'profile.web.1'] }),
    entry('web/open', 'Open profile', 'web', { origin: 'authored', steps: [{ kind: 'navigate', route: '/profile' }] }),
    entry('api/post-profile', 'Create profile', 'api', { resource: 'profiles', entry: { method: 'POST', path: '/profiles' } }),
    entry('api/get-profile', 'List profiles', 'api', { resource: 'profiles', entry: { method: 'GET', path: '/profiles' } }),
    entry('cli/profile-list', 'List profiles command', 'cli', { entry: { command: ['app', 'profile', 'list'] } }),
  ],
  resources: {
    web: [
      { id: 'profile', title: 'Profile', kind: 'screen', address: '/profile' },
      { id: 'settings-dialog', title: 'Settings dialog', kind: 'dialog', of: 'profile',
        readables: { markers: [{ marker: 'Saved successfully' }] } },
      { id: 'empty', title: 'Empty screen', kind: 'screen' },
    ],
    api: [{ id: 'profiles', title: '/profiles', kind: 'rest-noun' }],
  },
  states: { web: [{ id: 'saved', description: 'The profile changes are saved' }] },
};

describe('the full-page interface catalog', () => {
  it('aggregates dialog actions into screens and orders API operations while keeping commands separate', async () => {
    serve({ interfaces: CATALOG });
    renderAt(`/preview/repos/${REAL.id}/interfaces`);
    const table = await screen.findByRole('table', { name: 'Interfaces' });
    await within(table).findByRole('link', { name: 'Profile /profile' });
    const rows = within(table).getAllByRole('row');
    expect(rows).toHaveLength(6); // header, ways in, screen, two operations, command
    expect(within(table).queryByText('Settings dialog')).toBeNull();
    expect(within(table).queryByText('Save settings')).toBeNull();
    expect(within(table).queryByText('Empty screen')).toBeNull();
    expect(rows[2]).toHaveTextContent('2 tests'); // same flow on two actions counts once, plus id-only reference
    expect(rows[3]).toHaveTextContent('GET');
    expect(rows[4]).toHaveTextContent('POST');
    expect(rows[5]).toHaveTextContent('app profile list');
    expect(screen.getByText('1 screen with nothing to do hidden')).toBeInTheDocument();
  });

  it('finds a screen by its nested action and keeps mixed-origin screens in either origin filter', async () => {
    serve({ interfaces: CATALOG });
    renderAt(`/preview/repos/${REAL.id}/interfaces`);
    const user = userEvent.setup();
    const table = await screen.findByRole('table', { name: 'Interfaces' });
    await within(table).findByRole('link', { name: 'Profile /profile' });
    await user.type(screen.getByLabelText('Search interfaces'), 'Save changes');
    expect(within(table).getAllByRole('row')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'derived 4' }));
    expect(within(table).getByRole('link', { name: 'Profile /profile' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'authored 2' }));
    expect(within(table).getByRole('link', { name: 'Profile /profile' })).toBeInTheDocument();
  });

  it('opens a screen as its own page, expands its action and returns to the full catalog', async () => {
    serve({ interfaces: CATALOG });
    renderAt(`/preview/repos/${REAL.id}/interfaces`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Profile /profile' }));
    expect(await screen.findByText('Actions · 2')).toBeInTheDocument();
    expect(screen.getByText('The page shows · 1')).toBeInTheDocument();
    expect(screen.getByText(/Saved successfully/)).toBeInTheDocument();
    await user.click(screen.getByText('Save settings'));
    expect(await screen.findByText('Sequence')).toBeInTheDocument();
    expect(screen.getByText('The profile changes are saved')).toBeInTheDocument();
    expect(screen.queryByText('No contract derived')).toBeNull();
    expect(screen.queryByRole('button', { name: /Close web:/ })).toBeNull();
    await user.click(within(screen.getByRole('heading', { name: 'Profile', level: 1 }).closest('nav')!).getByRole('link', { name: 'Interfaces' }));
    expect(await screen.findByRole('table', { name: 'Interfaces' })).toBeInTheDocument();
  });

  it('opens an old task URL on its owning screen with the action expanded and allows collapse', async () => {
    serve({ interfaces: CATALOG });
    renderAt(`/preview/repos/${REAL.id}/interfaces/web%2Fsave`);
    const user = userEvent.setup();
    expect(await screen.findByText('Sequence')).toBeInTheDocument();
    expect(screen.getByText('Actions · 2')).toBeInTheDocument();
    await user.click(screen.getByText('Save settings'));
    expect(screen.queryByText('Sequence')).toBeNull();
    await user.click(screen.getByText('Save settings'));
    await user.click(screen.getByRole('button', { name: 'JSON' }));
    expect(await screen.findByText('{"id":"web/save"}')).toBeInTheDocument();
  });

  it('opens an API operation directly and follows its sibling on the same endpoint', async () => {
    serve({ interfaces: CATALOG });
    renderAt(`/preview/repos/${REAL.id}/interfaces/api:get-profile`);
    const user = userEvent.setup();
    expect(await screen.findByRole('heading', { name: 'GET /profiles' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'POST /profiles' }));
    expect(await screen.findByRole('heading', { name: 'POST /profiles' })).toBeInTheDocument();
  });

  it('filters by surface and opens the entry points outside any screen', async () => {
    serve({ interfaces: CATALOG });
    renderAt(`/preview/repos/${REAL.id}/interfaces`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Web 3' }));
    const table = screen.getByRole('table', { name: 'Interfaces' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).queryByText('Operation')).toBeNull();
    await user.click(within(table).getByRole('link', { name: /Ways in/ }));
    await user.click(await screen.findByText('Open profile'));
    expect(await screen.findByText('Sequence')).toBeInTheDocument();
    expect(screen.queryByText('No contract derived')).toBeNull();
  });

  it('opens a recipe scoped to its selected surface', async () => {
    serve({ interfaces: CATALOG, recipe: { surfaces: {
      web: { serve: ['pnpm', 'web'] }, cli: { build: 'pnpm build', entry: ['node', 'cli.js'] },
    }, fingerprint: 'sha256:abc', stale: false } });
    renderAt(`/preview/repos/${REAL.id}/interfaces`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Web recipe' }));
    const recipe = await screen.findByRole('region', { name: 'Recipe' });
    expect(within(recipe).getByText('pnpm web')).toBeInTheDocument();
    expect(within(recipe).queryByText('pnpm build')).toBeNull();
  });
});
