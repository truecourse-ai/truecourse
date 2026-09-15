/**
 * The signed-in user, in the shape the shell draws.
 *
 * The identity is the session's: it comes from the auth context's `AuthUser`,
 * so the name and the email in the user menu are the session's.
 *
 * With no session — a tree rendered without an auth provider, or a probe that
 * answered anon — there is no user, and the surfaces that draw one draw
 * nothing. Nobody is invented to fill the gap.
 */

import { useMemo } from 'react';
import type { AuthUser } from '@truecourse/shared';
import { useAuth } from '@/auth/AuthContext';
import type { DashboardUser } from '@/dashboard/data/types';

/** First + last, else the email — the only two things a WorkOS user always has. */
function displayName(user: AuthUser): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full || user.email;
}

export function toDashboardUser(user: AuthUser): DashboardUser {
  const name = displayName(user);
  return {
    name,
    email: user.email,
    initial: name.trim().charAt(0).toUpperCase(),
  };
}

export function useDashboardUser(): DashboardUser | null {
  const { status, user } = useAuth();
  return useMemo(
    () => (status === 'authed' && user ? toDashboardUser(user) : null),
    [status, user],
  );
}
