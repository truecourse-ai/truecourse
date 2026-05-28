/**
 * Unit tests for the ee-server WorkOS auth helpers that don't need live
 * credentials: the dependency-free cookie helpers, and the session
 * verifier's mapping of a WorkOS session to our framework-free AuthUser
 * (WorkOS client faked). The full OAuth round-trip is verified manually
 * against WorkOS — see the verification task.
 */

import { describe, it, expect } from 'vitest';
import type { WorkOS } from '@workos-inc/node';
import { parseCookies, serializeCookie } from '../../ee/packages/server/src/cookies';
import {
  createSessionVerifier,
  SESSION_COOKIE,
} from '../../ee/packages/server/src/auth';
import type { WorkosConfig } from '../../ee/packages/server/src/config';

const cfg: WorkosConfig = {
  apiKey: 'sk_test',
  clientId: 'client_test',
  redirectUri: 'http://localhost:3001/api/ee/auth/callback',
  cookiePassword: 'x'.repeat(32),
  appUrl: 'http://localhost:3000',
};

const USER = {
  id: 'u1',
  email: 'a@b.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  profilePictureUrl: null,
};

// Minimal WorkOS stand-in:
//   sealed 'good'    → authenticates.
//   sealed 'expired' → authenticate fails, refresh succeeds (cookie 'good2').
//   anything else    → both fail.
function fakeWorkos(): WorkOS {
  return {
    userManagement: {
      loadSealedSession: ({ sessionData }: { sessionData: string }) => ({
        authenticate: async () =>
          sessionData === 'good'
            ? { authenticated: true, user: USER, organizationId: 'org_1' }
            : { authenticated: false },
        refresh: async () =>
          sessionData === 'expired'
            ? {
                authenticated: true,
                user: USER,
                organizationId: 'org_1',
                sealedSession: 'good2',
              }
            : { authenticated: false },
      }),
    },
  } as unknown as WorkOS;
}

describe('cookie helpers', () => {
  it('round-trips a value', () => {
    const header = serializeCookie(SESSION_COOKIE, 'abc123', { maxAgeSeconds: 60 });
    expect(header).toContain(`${SESSION_COOKIE}=abc123`);
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Max-Age=60');
    expect(parseCookies(header.split(';')[0])[SESSION_COOKIE]).toBe('abc123');
  });

  it('parses multiple cookies and tolerates junk', () => {
    expect(parseCookies('a=1; b=2; junk; c=3')).toEqual({ a: '1', b: '2', c: '3' });
    expect(parseCookies(undefined)).toEqual({});
  });

  it('omits Secure unless requested', () => {
    expect(serializeCookie('x', 'y')).not.toContain('Secure');
    expect(serializeCookie('x', 'y', { secure: true })).toContain('Secure');
  });
});

describe('createSessionVerifier', () => {
  const verify = createSessionVerifier(fakeWorkos(), cfg);

  it('returns null with no cookie', async () => {
    expect(await verify(undefined)).toBeNull();
  });

  it('returns null when the session fails to authenticate (and cannot refresh)', async () => {
    expect(await verify(`${SESSION_COOKIE}=bad`)).toBeNull();
  });

  it('maps an authenticated WorkOS session to AuthResult.user', async () => {
    const result = await verify(`${SESSION_COOKIE}=good`);
    expect(result?.user).toEqual({
      id: 'u1',
      email: 'a@b.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      profilePictureUrl: null,
      organizationId: 'org_1',
    });
    // No refresh needed when the access token is still valid.
    expect(result?.setCookie).toBeUndefined();
  });

  it('transparently refreshes an expired session and returns the rotated cookie', async () => {
    const result = await verify(`${SESSION_COOKIE}=expired`);
    expect(result?.user.id).toBe('u1');
    expect(result?.setCookie).toContain(`${SESSION_COOKIE}=good2`);
  });
});
