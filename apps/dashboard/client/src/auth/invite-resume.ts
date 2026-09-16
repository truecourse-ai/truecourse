/**
 * An invite page remembered across a sign-out.
 *
 * Switching account on `/invite/:token` signs out through the identity
 * provider, which returns the browser to the app root: the only address it is
 * configured to return to, since a per-token one cannot be listed there. The
 * page leaves its own address here first, and the auth gate, seeing it on the
 * way back, sends the visitor to the invite instead of into sign-in. Session
 * storage is per tab and survives the round trip; it is taken once.
 */

const KEY = 'tc.invite.resume';

export function rememberInvite(path: string): void {
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // Storage withheld: the visitor lands on the root and opens the link again.
  }
}

/** The remembered invite page, taken; null when there is none. */
export function takeRememberedInvite(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    if (path) sessionStorage.removeItem(KEY);
    return path && path.startsWith('/invite/') ? path : null;
  } catch {
    return null;
  }
}
