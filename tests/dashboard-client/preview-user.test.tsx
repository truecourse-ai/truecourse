/**
 * The shell's account is the SIGNED-IN one: the user in the menu, and the name
 * of the workspace they are actually in.
 *
 * `usePreviewUser` maps the auth context's `AuthUser` into the shape the shell
 * draws, and answers null when there is no session — nobody is invented to fill
 * the gap, so the surfaces that draw a user simply draw none. The workspace
 * follows the same rule: it is the signed-in organization, or nothing.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { AuthUser } from '@truecourse/shared';
import { AuthProvider } from '@/ee/AuthContext';
import { toPreviewUser, usePreviewUser } from '@/preview/shell/use-preview-user';
import { PreviewStateProvider, usePreviewState } from '@/preview/shell/preview-state';

// The shell holds a socket for the repositories' runs; none of these cases
// is about that, so it is a stub that answers nothing.
vi.mock('@/lib/socket', () => {
  const socket = { connected: true, on: () => socket, off: () => socket, emit: () => {} };
  return {
    connectSocket: () => socket,
    getSocket: () => socket,
    disconnectSocket: () => {},
    joinRepoRoom: () => {},
    leaveRepoRoom: () => {},
  };
});

// `/me` answers with the session; every other request (the repo registry)
// 404s, which is the "no server behind it" case.
function stubMe(user: AuthUser) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes('/api/auth/me')
        ? new Response(JSON.stringify({ user }), { status: 200 })
        : new Response('', { status: 404 }),
    ),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('toPreviewUser', () => {
  const base: AuthUser = { id: 'user_1', email: 'dana@acme.dev' };

  it('names the user by first + last, and takes the initial from that name', () => {
    expect(toPreviewUser({ ...base, firstName: 'Dana', lastName: 'Rees' })).toEqual({
      name: 'Dana Rees',
      email: 'dana@acme.dev',
      initial: 'D',
      isOperator: false,
    });
  });

  it('falls back to the email when there is no name, initial included', () => {
    expect(toPreviewUser(base)).toMatchObject({ name: 'dana@acme.dev', initial: 'D' });
    expect(toPreviewUser({ ...base, firstName: null, lastName: null })).toMatchObject({
      name: 'dana@acme.dev',
    });
  });

  it('uses whichever half of the name it has', () => {
    expect(toPreviewUser({ ...base, firstName: 'Dana' })).toMatchObject({ name: 'Dana' });
    expect(toPreviewUser({ ...base, lastName: 'Rees' })).toMatchObject({
      name: 'Rees',
      initial: 'R',
    });
  });

  it('passes the operator flag through', () => {
    expect(toPreviewUser({ ...base, isOperator: true }).isOperator).toBe(true);
  });
});

describe('usePreviewUser', () => {
  it('is the signed-in user once the session probe answers', async () => {
    stubMe({
      id: 'user_1',
      email: 'dana@acme.dev',
      firstName: 'Dana',
      lastName: 'Rees',
      isOperator: true,
    });

    const { result } = renderHook(() => usePreviewUser(), { wrapper: AuthProvider });

    await waitFor(() => expect(result.current?.name).toBe('Dana Rees'));
    expect(result.current?.email).toBe('dana@acme.dev');
    expect(result.current?.initial).toBe('D');
    expect(result.current?.isOperator).toBe(true);
  });

  it('is nobody with no provider above it, rather than a stand-in', () => {
    const { result } = renderHook(() => usePreviewUser());
    expect(result.current).toBeNull();
  });
});

describe('the active workspace', () => {
  const withAuth = ({ children }: { children: ReactNode }) => (
    <AuthProvider>
      <PreviewStateProvider>{children}</PreviewStateProvider>
    </AuthProvider>
  );

  it('is the signed-in organization, named and initialled by it', async () => {
    stubMe({
      id: 'user_1',
      email: 'dana@acme.dev',
      organizationId: 'org_1',
      organizationName: 'Northwind Labs',
    });

    const { result } = renderHook(() => usePreviewState(), { wrapper: withAuth });

    await waitFor(() => expect(result.current.workspace?.name).toBe('Northwind Labs'));
    expect(result.current.workspace?.initial).toBe('N');
    expect(result.current.workspace?.id).toBe('org_1');
  });

  it('is no workspace at all with no session', () => {
    const { result } = renderHook(() => usePreviewState(), {
      wrapper: PreviewStateProvider,
    });
    expect(result.current.workspace).toBeNull();
    expect(result.current.repos).toEqual([]);
    expect(result.current.notifications).toEqual([]);
    expect(result.current.jobs).toEqual([]);
  });
});
