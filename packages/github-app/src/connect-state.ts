/**
 * The two signed tokens a trip to GitHub rides on.
 *
 * The STATE goes out with the trip and comes back untouched on the callback,
 * so the callback knows WHICH workspace asked and WHO, and that the person
 * landing back is the one who left: a code from someone else's trip, pasted
 * onto a member's session, must not attach that someone's installations to
 * the member's workspace.
 *
 * The OFFER is what the callback hands back when GitHub named installations
 * the workspace does not hold yet: the candidates, signed, for the person to
 * pick from on the page they land on. Nothing is attached until they do, and
 * the attach route takes the offer back to prove the list is the one GitHub
 * gave THIS session.
 *
 * Stateless by design: each payload is signed with the server's own secret,
 * and the session that presents it has to match it. Nothing is stored for
 * the duration of the trip.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GithubInstallOrigin } from '@truecourse/shared';
import type { UserInstallation } from './oauth.js';

interface Trip {
  /** The workspace that started the trip. */
  orgId: string;
  /** The person who started it. */
  userId: string;
  /** Where the trip started, so the return can land there; null for Settings. */
  origin: GithubInstallOrigin | null;
  /** Unix ms after which the token is refused. */
  expiresAt: number;
}

export interface ConnectState extends Trip {
  kind: 'state';
}

export interface ConnectOffer extends Trip {
  kind: 'offer';
  /** The installations GitHub named that the workspace does not hold. */
  installations: UserInstallation[];
}

/** How long a trip to GitHub may take, and how long an offer stays open. */
export const CONNECT_STATE_TTL_MS = 10 * 60 * 1000;

const sign = (payload: string, secret: string): string =>
  createHmac('sha256', secret).update(payload).digest('base64url');

function signToken(token: ConnectState | ConnectOffer, secret: string): string {
  const payload = Buffer.from(JSON.stringify(token)).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

/** The token's payload when the signature and the clock allow it, else null. */
function verifyToken(raw: string | undefined, secret: string, now: number): unknown {
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot === -1) return null;
  const payload = raw.slice(0, dot);
  const given = Buffer.from(raw.slice(dot + 1));
  const expected = Buffer.from(sign(payload, secret));
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const token = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<Trip>;
    if (typeof token.orgId !== 'string' || typeof token.userId !== 'string') return null;
    if (typeof token.expiresAt !== 'number' || token.expiresAt < now) return null;
    return token;
  } catch {
    return null;
  }
}

export function signConnectState(state: Omit<ConnectState, 'kind'>, secret: string): string {
  return signToken({ ...state, kind: 'state' }, secret);
}

/** The state behind a signed token, or null when the signature or the clock says no. */
export function verifyConnectState(
  raw: string | undefined,
  secret: string,
  now = Date.now(),
): ConnectState | null {
  const token = verifyToken(raw, secret, now) as ConnectState | null;
  return token?.kind === 'state' ? token : null;
}

export function signConnectOffer(offer: Omit<ConnectOffer, 'kind'>, secret: string): string {
  return signToken({ ...offer, kind: 'offer' }, secret);
}

/** The offer behind a signed token, or null when the signature or the clock says no. */
export function verifyConnectOffer(
  raw: string | undefined,
  secret: string,
  now = Date.now(),
): ConnectOffer | null {
  const token = verifyToken(raw, secret, now) as ConnectOffer | null;
  return token?.kind === 'offer' && Array.isArray(token.installations) ? token : null;
}
