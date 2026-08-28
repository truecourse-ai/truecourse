/**
 * The signed-in user, in the shape the shell draws.
 *
 * The shell's identity is REAL: it comes from the auth context's `AuthUser`,
 * so the avatar, the name and the email in the user menu are the session's,
 * and the Admin entry appears for the operators the server actually marks.
 *
 * The fixture user is the fallback, for a tree with no auth provider above it
 * — the preview's own render tests, which mount the shell on fake data alone.
 */

import { useMemo } from 'react';
import type { AuthUser } from '@truecourse/shared';
import { useEeAuth } from '@/ee/EeAuthContext';
import { USER } from '@/preview/data';
import type { PreviewUser } from '@/preview/data/types';

/** First + last, else the email — the only two things a WorkOS user always has. */
function displayName(user: AuthUser): string {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  return full || user.email;
}

export function toPreviewUser(user: AuthUser): PreviewUser {
  const name = displayName(user);
  return {
    name,
    email: user.email,
    initial: name.trim().charAt(0).toUpperCase(),
    isOperator: user.isOperator ?? false,
    // Everyone signed in is an admin of their workspace until entitlements
    // land and the server has a per-member role to hand back.
    role: 'admin',
  };
}

export function usePreviewUser(): PreviewUser {
  const { status, user } = useEeAuth();
  return useMemo(
    () => (status === 'authed' && user ? toPreviewUser(user) : USER),
    [status, user],
  );
}
