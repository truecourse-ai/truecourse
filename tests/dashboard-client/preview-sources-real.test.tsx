/**
 * The Sources tab of a CONNECTED repository reads the server, not the
 * fixtures: the stored documentation sites as a table even when nothing else
 * has run, one site as its own page with the pages it snapshotted, and a page's
 * markdown from the doc route.
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
  id: 'linkwarden',
  name: 'linkwarden/linkwarden',
  path: 'linkwarden/linkwarden',
  remoteUrl: 'https://github.com/linkwarden/linkwarden',
};

const SOURCE_ID = 'docs.strapi.io';
const INSTALL_REF = `.truecourse/specs/sources/${SOURCE_ID}/cms/installation.md`;

const STRAPI = {
  id: SOURCE_ID,
  title: 'Strapi Docs',
  llmsTxtUrl: 'https://docs.strapi.io/llms.txt',
  fetchedAt: '2026-07-29T10:15:00.000Z',
  docCount: 2,
  skipped: [{ url: 'https://github.com/strapi/strapi', reason: 'external-origin' }],
};

const STRAPI_DETAIL = {
  ...STRAPI,
  docs: [
    { ref: INSTALL_REF, path: 'cms/installation.md', title: 'Installation', url: 'https://docs.strapi.io/cms/installation' },
    { ref: `.truecourse/specs/sources/${SOURCE_ID}/cms/api/rest.md`, path: 'cms/api/rest.md', title: 'REST API', url: 'https://docs.strapi.io/cms/api/rest' },
  ],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A world: one connected repository whose server holds one source and no corpus yet. */
function serve() {
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
    if (rest === 'spec/sources') return json({ sources: [STRAPI] });
    if (rest === `spec/sources/${SOURCE_ID}`) return json({ source: STRAPI_DETAIL });
    if (rest === 'spec/corpus') return json({ error: 'no corpus' }, 404);
    if (rest === 'spec/doc') {
      const ref = url.searchParams.get('ref') ?? '';
      return ref === INSTALL_REF
        ? json({ ref, content: '# Installation\n\nStrapi runs on Node 20.\n' })
        : json({ error: `Doc not found: ${ref}` }, 404);
    }
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

const SOURCES_TAB = `/preview/repos/${REAL.id}/sources`;

beforeEach(() => {
  window.history.replaceState({}, '', '/preview');
});

afterEach(() => {
  window.fetch = realFetch;
});

describe('the Sources tab of a connected repository', () => {
  it('lists the stored sites even before anything else has run', async () => {
    const calls = serve();
    renderAt(SOURCES_TAB);

    const table = await screen.findByRole('table', { name: 'Documentation sites' });
    const row = (await within(table).findByText('Strapi Docs')).closest('tr')!;
    expect(within(row).getByText('https://docs.strapi.io/llms.txt')).toBeInTheDocument();
    expect(within(row).getByText('2 pages')).toBeInTheDocument();
    expect(calls).toContain(`/api/repos/${REAL.id}/spec/sources`);
    expect(screen.queryByText('Nothing has run on this repository yet')).toBeNull();
  });

  it('opens a site as its own page and reads a page from the server', async () => {
    const calls = serve();
    renderAt(SOURCES_TAB);

    await userEvent.click(await screen.findByText('Strapi Docs'));
    // The site's pages, from the detail read.
    await screen.findByText('Installation');
    expect(screen.getByText('REST API')).toBeInTheDocument();
    expect(calls).toContain(`/api/repos/${REAL.id}/spec/sources/${SOURCE_ID}`);

    await userEvent.click(screen.getByText('Installation'));
    expect(await screen.findByText('Strapi runs on Node 20.')).toBeInTheDocument();
    expect(calls.some((c) => c.startsWith(`/api/repos/${REAL.id}/spec/doc?ref=`))).toBe(true);
    // No scan yet: the page says what would put it in the corpus.
    expect(await screen.findByText('Run Scan to add this page to the corpus.')).toBeInTheDocument();
  });
});
