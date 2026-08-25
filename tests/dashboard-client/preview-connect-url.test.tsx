// PREVIEW: the connect-by-URL path is the one REAL seam of the preview; delete
// with the preview when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * Connecting a public repository by URL, from the one-product shell.
 *
 * Everything else in the preview is fake, so this file is about the seam: the
 * dialog posts to the real `/api/repos/connect`, the shell re-reads the real
 * `/api/repos`, and a repository that came back that way renders on Home with
 * none of the fixture coverage the mock repositories have.
 *
 * `window.fetch` is replaced wholesale rather than routed around the preview's
 * own shim: the shim is installed once when the preview chunk loads (it never
 * uninstalls), and replacing the global is what a caller's stub does anyway.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import PreviewApp from '@/preview/PreviewApp';
import { parseRemote, toPreviewRepo } from '@/preview/data/real-repos';

if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = (() => {}) as Element['scrollTo'];
}

interface RegistryEntry {
  id: string;
  name: string;
  path: string;
  remoteUrl?: string | null;
  defaultBranch?: string;
}

const realFetch = window.fetch;

/** A server holding `registry`, answering connect with `onConnect`. */
function serve(registry: RegistryEntry[], onConnect: (url: string) => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    const method = (init?.method ?? 'GET').toUpperCase();
    if (pathname === '/api/repos' && method === 'GET') {
      return json(registry);
    }
    if (pathname === '/api/repos/connect' && method === 'POST') {
      const body = JSON.parse(String(init?.body ?? '{}')) as { url?: string };
      return onConnect(String(body.url ?? ''));
    }
    // Every per-repo guard route: the preview's own shim would answer these from
    // the fixtures, and a repository with no fixtures has nothing to answer with.
    return json({ error: 'not found' }, 404);
  });
  window.fetch = fetchMock as unknown as typeof window.fetch;
  return fetchMock;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
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

describe('a remote URL as a preview repository', () => {
  it('reads owner/repo and the provider off the host', () => {
    expect(parseRemote('https://github.com/acme/orders-api.git')).toEqual({
      fullName: 'acme/orders-api',
      provider: 'github',
    });
    expect(parseRemote('https://gitlab.com/group/sub/thing')).toEqual({
      fullName: 'sub/thing',
      provider: 'gitlab',
    });
    expect(parseRemote('https://dev.azure.com/acme/billing')).toEqual({
      fullName: 'acme/billing',
      provider: 'azure',
    });
    // No fourth icon in the preview: an unfamiliar host reads as github.
    expect(parseRemote('https://git.sr.ht/~user/thing').provider).toBe('github');
  });

  it('maps a registry entry to a repository with no history behind it', () => {
    const repo = toPreviewRepo({
      id: 'orders-api',
      name: 'acme/orders-api',
      path: '/clones/acme__orders-api',
      remoteUrl: 'https://github.com/acme/orders-api',
      defaultBranch: 'trunk',
    });
    expect(repo).toMatchObject({
      id: 'orders-api',
      fullName: 'acme/orders-api',
      provider: 'github',
      visibility: 'public',
      defaultBranch: 'trunk',
      policy: 'advisory',
      baselineSha: 'no baseline yet',
      onboarding: false,
      real: true,
    });
    expect(repo.lastCheck).toEqual({
      conclusion: 'neutral',
      word: 'Neutral',
      summary: 'Connected, nothing has run yet',
      at: 'just now',
    });
  });
});

describe('connecting a repository by URL', () => {
  it('lists a connected repository on Home with no coverage yet', async () => {
    serve(
      [
        // A path-registered repo of the developer's own: never the product's business.
        { id: 'local-thing', name: 'local-thing', path: '/home/dev/local-thing' },
        {
          id: 'linkwarden',
          name: 'linkwarden/linkwarden',
          path: '/clones/linkwarden__linkwarden',
          remoteUrl: 'https://github.com/linkwarden/linkwarden',
        },
      ],
      () => json({ error: 'not called' }, 500),
    );
    renderAt('/preview');
    const name = await screen.findByText('linkwarden/linkwarden');
    expect(screen.queryByText('local-thing')).toBeNull();
    // No fixtures are keyed by its slug, so its requirements cell is the empty
    // one and its proven share is blank.
    const row = name.closest('tr')!;
    expect(within(row).getByText('no corpus yet')).toBeInTheDocument();
    expect(within(row).getByText('Neutral')).toBeInTheDocument();
  });

  it('closes on success and shows the repository the server registered', async () => {
    const registry: RegistryEntry[] = [];
    serve(registry, (url) => {
      const entry: RegistryEntry = {
        id: 'linkwarden',
        name: 'linkwarden/linkwarden',
        path: '/clones/linkwarden__linkwarden',
        remoteUrl: url,
      };
      registry.push(entry);
      return json(entry, 201);
    });

    renderAt('/preview?connect=1');
    const input = await screen.findByLabelText('Or connect a public repository by URL');
    await userEvent.type(input, 'https://github.com/linkwarden/linkwarden');
    await userEvent.click(within(input.closest('form')!).getByRole('button', { name: 'Connect' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('linkwarden/linkwarden')).toBeInTheDocument();
  });

  it('keeps the dialog open and names the reason when the server refuses', async () => {
    serve([], () => json({ error: 'acme/orders-api is already connected', repoId: 'orders-api' }, 409));

    renderAt('/preview?connect=1');
    const input = await screen.findByLabelText('Or connect a public repository by URL');
    const submit = within(input.closest('form')!).getByRole('button', { name: 'Connect' });
    await userEvent.type(input, 'https://github.com/acme/orders-api');
    await userEvent.click(submit);

    expect(await screen.findByText('acme/orders-api is already connected')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(input.closest('form')!).getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  it('is a mock with no server behind it: the fixtures render and nothing throws', async () => {
    window.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof window.fetch;
    renderAt('/preview');
    expect(await screen.findByText('acme/orders-api')).toBeInTheDocument();
  });
});
