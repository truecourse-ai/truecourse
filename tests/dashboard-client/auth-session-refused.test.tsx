/**
 * A request the server refused as unauthenticated after the page loaded. The
 * auth provider probes the session again and acts on the difference: gone →
 * anonymous; the same person in another workspace or none → a reload; the same
 * session → nothing. Only a 401 raises it.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from '@/auth/AuthContext';
import { fetchApi } from '@/lib/api';

const ME = { id: 'user_me', email: 'dana@acme.dev', organizationId: 'org_1' };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const realFetch = window.fetch;
const realLocation = window.location;

let me: () => Response;
let probes = 0;

function serve(answer: () => Response) {
  me = answer;
  probes = 0;
  window.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const { pathname } = new URL(href, window.location.origin);
    if (pathname === '/api/auth/me') {
      probes += 1;
      return me();
    }
    if (pathname === '/api/refused') return json({ error: 'Authentication required' }, 401);
    if (pathname === '/api/forbidden') return json({ error: 'Not yours' }, 403);
    return json({ error: 'not found' }, 404);
  }) as unknown as typeof window.fetch;
}

function captureReloads() {
  const reloads = { count: 0 };
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...realLocation, origin: 'http://localhost:3000', reload: () => (reloads.count += 1) },
  });
  return reloads;
}

function Who() {
  const { status, user } = useAuth();
  return <p>{`${status}:${user?.organizationId ?? '-'}`}</p>;
}

async function settle() {
  await act(() => new Promise((r) => setTimeout(r, 20)));
}

afterEach(() => {
  window.fetch = realFetch;
  Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
});

describe('a refused request after load', () => {
  it('reloads when the same person is now in another workspace', async () => {
    serve(() => json({ user: ME }));
    const reloads = captureReloads();
    render(<AuthProvider><Who /></AuthProvider>);
    await screen.findByText('authed:org_1');

    me = () => json({ user: { ...ME, organizationId: 'org_2' } });
    await expect(fetchApi('/api/refused')).rejects.toThrow('Authentication required');

    await waitFor(() => expect(reloads.count).toBe(1));
  });

  it('reloads when the same person is in no workspace any more', async () => {
    serve(() => json({ user: ME }));
    const reloads = captureReloads();
    render(<AuthProvider><Who /></AuthProvider>);
    await screen.findByText('authed:org_1');

    me = () => json({ user: { ...ME, organizationId: null } });
    await expect(fetchApi('/api/refused')).rejects.toThrow();

    await waitFor(() => expect(reloads.count).toBe(1));
  });

  it('turns anonymous when the session is gone', async () => {
    serve(() => json({ user: ME }));
    const reloads = captureReloads();
    render(<AuthProvider><Who /></AuthProvider>);
    await screen.findByText('authed:org_1');

    me = () => json({ error: 'Not authenticated' }, 401);
    await expect(fetchApi('/api/refused')).rejects.toThrow();

    expect(await screen.findByText('anon:-')).toBeInTheDocument();
    expect(reloads.count).toBe(0);
  });

  it('does nothing when the session is unchanged, so a refusal cannot loop', async () => {
    serve(() => json({ user: ME }));
    const reloads = captureReloads();
    render(<AuthProvider><Who /></AuthProvider>);
    await screen.findByText('authed:org_1');

    await expect(fetchApi('/api/refused')).rejects.toThrow();
    await expect(fetchApi('/api/refused')).rejects.toThrow();
    await settle();

    expect(reloads.count).toBe(0);
    expect(screen.getByText('authed:org_1')).toBeInTheDocument();
    expect(probes).toBeGreaterThanOrEqual(2);
  });

  it('is raised by a 401 only', async () => {
    serve(() => json({ user: ME }));
    captureReloads();
    render(<AuthProvider><Who /></AuthProvider>);
    await screen.findByText('authed:org_1');
    const before = probes;

    await expect(fetchApi('/api/forbidden')).rejects.toThrow('Not yours');
    await settle();

    expect(probes).toBe(before);
  });
});
