/**
 * The `state` that rides a trip to GitHub and back. GitHub echoes it
 * untouched on the callback, so it is how the callback knows WHICH workspace
 * asked and WHO, and that the person landing back is the one who left: a
 * code from someone else's trip, pasted onto a member's session, must not
 * attach that someone's installations to the member's workspace.
 *
 * Stateless by design: the payload is signed with the server's own secret,
 * and the session on the callback has to match it. Nothing is stored for the
 * duration of the trip.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GithubInstallOrigin } from '@truecourse/shared';

export interface ConnectState {
  /** The workspace that started the trip. */
  orgId: string;
  /** The person who started it. */
  userId: string;
  /** Where the trip started, so the return can land there; null for Settings. */
  origin: GithubInstallOrigin | null;
  /** Unix ms after which the state is refused. */
  expiresAt: number;
}

/** How long a trip to GitHub may take. */
export const CONNECT_STATE_TTL_MS = 10 * 60 * 1000;

const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

export function signConnectState(state: ConnectState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(state)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** The state behind a signed token, or null when the signature or the clock says no. */
export function verifyConnectState(
  raw: string | undefined,
  secret: string,
  now = Date.now(),
): ConnectState | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1));
  const expected = Buffer.from(sign(payload, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const state = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as ConnectState;
    if (typeof state.orgId !== 'string' || typeof state.userId !== 'string') return null;
    if (typeof state.expiresAt !== 'number' || state.expiresAt < now) return null;
    return state;
  } catch {
    return null;
  }
}
