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

const surface = (id: string, label: string, source?: string) => ({
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
function serve(options: { interfaces?: unknown; interfacesStatus?: number } = {}) {
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
    if (rest === 'guard/flows') return json({ flows: [], recipe: null });
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
  it('lists the stored catalog joined with its registered instances', async () => {
    const calls = serve();
    renderAt(`/preview/repos/${REAL.id}/dependencies`);

    const table = await screen.findByRole('table', { name: 'Dependencies' });
    await within(table).findByText('anthropic');
    expect(within(table).getByText('target-file')).toBeInTheDocument();
    expect(within(table).getByText('supplied')).toBeInTheDocument();
    expect(within(table).getByText('step-creatable')).toBeInTheDocument();
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
