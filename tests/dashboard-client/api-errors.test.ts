/**
 * What a refused request says: a route's own JSON `error` verbatim, and for
 * anything else the status, never the body.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, fetchApi } from '@/lib/api';

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(status: number, body: string, contentType: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(body, { status, headers: { 'content-type': contentType } })),
  );
}

describe('fetchApi on a refusal', () => {
  it('shows a JSON error as the route wrote it', async () => {
    answer(400, JSON.stringify({ error: 'A workspace name of 1 to 80 characters is required.' }), 'application/json');
    const err = await fetchApi('/api/auth/workspaces', { method: 'POST' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('A workspace name of 1 to 80 characters is required.');
    expect((err as ApiError).body).toEqual({ error: 'A workspace name of 1 to 80 characters is required.' });
  });

  it('shows the status for a non-JSON body and keeps the body on the error', async () => {
    answer(404, '<html><body>Cannot POST /api/auth/workspaces</body></html>', 'text/html');
    const err = await fetchApi('/api/auth/workspaces', { method: 'POST' }).catch((e: unknown) => e);
    expect((err as ApiError).message).toBe('The server answered 404 for POST /api/auth/workspaces');
    expect((err as ApiError).body).toContain('Cannot POST');
  });

  it('shows the status for an empty body', async () => {
    answer(502, '', 'text/plain');
    const err = await fetchApi('/api/home').catch((e: unknown) => e);
    expect((err as ApiError).message).toBe('The server answered 502 for GET /api/home');
    expect((err as ApiError).body).toBeNull();
  });
});
