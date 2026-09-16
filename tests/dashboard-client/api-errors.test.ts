/**
 * What a refused request says: a route's own JSON `error` verbatim, and for
 * anything else the status — never the body, and never the URL, which on an
 * invite link carries the token.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ApiError, fetchApi, getGuardEvidence } from '@/lib/api';

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
    expect((err as ApiError).message).toBe('The server answered 404.');
    expect((err as ApiError).body).toContain('Cannot POST');
  });

  it('shows the status for an empty body', async () => {
    answer(502, '', 'text/plain');
    const err = await fetchApi('/api/home').catch((e: unknown) => e);
    expect((err as ApiError).message).toBe('The server answered 502.');
    expect((err as ApiError).body).toBeNull();
  });

  it('keeps the invite token out of the message', async () => {
    answer(502, '<html>Bad gateway</html>', 'text/html');
    const err = await fetchApi('/api/auth/invite/tok_secret').catch((e: unknown) => e);
    expect((err as ApiError).message).not.toContain('tok_secret');
  });
});

describe('the evidence reads on a refusal', () => {
  it('say what the route said, not its JSON', async () => {
    answer(404, JSON.stringify({ error: 'Evidence not found.' }), 'application/json');
    const err = await getGuardEvidence('r1', 'run1', 's1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe('Evidence not found.');
  });

  it('show the status for a proxy page', async () => {
    answer(502, '<html>Bad gateway</html>', 'text/html');
    const err = await getGuardEvidence('r1', 'run1', 's1').catch((e: unknown) => e);
    expect((err as ApiError).message).toBe('The server answered 502.');
  });
});
