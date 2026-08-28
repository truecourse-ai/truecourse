/**
 * The shell's user is the SIGNED-IN one.
 *
 * `usePreviewUser` maps the auth context's `AuthUser` into the shape the
 * preview shell draws, and falls back to the fixture user when there is no
 * auth provider above it — which is what keeps the fixture-rendered preview
 * tests (and the mock's own screens) whole.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { AuthUser } from '@truecourse/shared';
import { EeAuthProvider } from '@/ee/EeAuthContext';
import { USER } from '@/preview/data';
import { toPreviewUser, usePreviewUser } from '@/preview/shell/use-preview-user';

function stubMe(user: AuthUser) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ user }), { status: 200 })),
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
      role: 'admin',
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

    const { result } = renderHook(() => usePreviewUser(), { wrapper: EeAuthProvider });

    await waitFor(() => expect(result.current.name).toBe('Dana Rees'));
    expect(result.current.email).toBe('dana@acme.dev');
    expect(result.current.initial).toBe('D');
    expect(result.current.isOperator).toBe(true);
  });

  it('is the fixture user with no provider above it', () => {
    const { result } = renderHook(() => usePreviewUser());
    expect(result.current).toEqual(USER);
  });
});
