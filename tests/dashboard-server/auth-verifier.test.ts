/**
 * The session verifier (`createSessionVerifier`) and the cookie parsing it
 * stands on. Three hazards live here, all of them invisible to the happy path:
 * a malformed Cookie header must not throw out of an async handler, a refresh
 * must be memoized past the moment it settles (WorkOS rotates refresh tokens),
 * and the per-request operator lookup must collapse into one call — and cache
 * its failures — instead of stampeding WorkOS.
 * WorkOS is faked throughout; the tests assert orchestration, not the SDK.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { parseCookies } from '../../apps/dashboard/server/src/auth/cookies';
import {
  createAuthRouter,
  createSessionVerifier,
} from '../../apps/dashboard/server/src/auth/workos-auth';

const cfg = {
  apiKey: 'sk_test',
  clientId: 'client_test',
  redirectUri: 'http://localhost:3001/api/auth/callback',
  cookiePassword: 'x'.repeat(40),
  appUrl: 'http://localhost:3000',
} as const;

interface FakeUser {
  id: string;
  email: string;
  metadata?: Record<string, string>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function verifierFor(workos: unknown) {
  return createSessionVerifier(workos as any, cfg as any);
}

function appFor(workos: unknown, verify: unknown): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', createAuthRouter(workos as any, cfg as any, verify as any));
  return app;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** A WorkOS whose sealed sessions authenticate straight away. */
function makeAuthenticatedWorkos(userId: string, getUser: (id: string) => Promise<FakeUser>) {
  const user: FakeUser = { id: userId, email: `${userId}@acme.test` };
  return {
    userManagement: {
      getUser: vi.fn(getUser),
      loadSealedSession: vi.fn(() => ({
        authenticate: async () => ({ authenticated: true, user, organizationId: 'org_1' }),
        refresh: async () => {
          throw new Error('should not refresh a live session');
        },
      })),
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('parseCookies', () => {
  it('decodes percent-encoded values', () => {
    expect(parseCookies('tc_session=a%3Ab')).toEqual({ tc_session: 'a:b' });
  });

  // A stray `%` is legal in a Cookie header and browsers send every cookie for
  // the host (ports are ignored), so an unrelated localhost cookie can carry one.
  it('keeps an undecodable value raw and still parses its neighbours', () => {
    expect(parseCookies('x=%; tc_session=abc')).toEqual({ x: '%', tc_session: 'abc' });
  });
});

describe('createSessionVerifier: malformed cookies', () => {
  it('returns null for an undecodable Cookie header instead of throwing', async () => {
    const workos = makeAuthenticatedWorkos('user_malformed', async (id) => ({
      id,
      email: 'u@acme.test',
    }));
    await expect(verifierFor(workos)('x=%')).resolves.toBeNull();
    expect(workos.userManagement.loadSealedSession).not.toHaveBeenCalled();
  });

  it('401s /api/auth/me and still answers /logout when the header is malformed', async () => {
    const workos = makeAuthenticatedWorkos('user_malformed_route', async (id) => ({
      id,
      email: 'u@acme.test',
    }));
    const app = appFor(workos, verifierFor(workos));

    await request(app).get('/api/auth/me').set('Cookie', 'x=%').expect(401);
    // `/logout` parses the header itself, outside any try/catch.
    await request(app).post('/api/auth/logout').set('Cookie', 'x=%').expect(200);
  });
});

/**
 * A WorkOS whose sealed session is expired: `authenticate()` says
 * unauthenticated and `refresh()` succeeds EXACTLY once — the rotated refresh
 * token makes every later attempt with the same sealed cookie fail, which is
 * what the real service does.
 */
function makeExpiredWorkos(userId: string, opts: { refreshSucceeds?: boolean } = {}) {
  const user: FakeUser = { id: userId, email: `${userId}@acme.test` };
  let refreshCalls = 0;
  const refresh = async () => {
    refreshCalls += 1;
    if (refreshCalls > 1) throw new Error('refresh token already rotated');
    if (opts.refreshSucceeds === false) return { authenticated: false };
    return {
      authenticated: true,
      sealedSession: 'sealed:rotated',
      user,
      organizationId: 'org_1',
    };
  };
  const workos = {
    userManagement: {
      getUser: vi.fn(async (id: string) => ({ id, email: user.email })),
      loadSealedSession: vi.fn(() => ({
        authenticate: async () => ({ authenticated: false }),
        refresh,
      })),
    },
  };
  return { workos, refreshCalls: () => refreshCalls };
}

describe('createSessionVerifier: refresh single-flight', () => {
  it('serves a late request the memoized refresh instead of retrying a rotated token', async () => {
    const { workos, refreshCalls } = makeExpiredWorkos('user_refresh_1');
    const verify = verifierFor(workos);

    const first = await verify('tc_session=sealed-expired');
    // Arrives after the refresh settled but before its Set-Cookie landed.
    const second = await verify('tc_session=sealed-expired');

    expect(first?.user.id).toBe('user_refresh_1');
    expect(second?.user.id).toBe('user_refresh_1');
    expect(second?.setCookie).toBe(first?.setCookie);
    expect(refreshCalls()).toBe(1);
  });

  it('memoizes a refusal too, so a dead cookie does not re-attempt the refresh', async () => {
    const { workos, refreshCalls } = makeExpiredWorkos('user_refresh_2', {
      refreshSucceeds: false,
    });
    const verify = verifierFor(workos);

    await expect(verify('tc_session=dead')).resolves.toBeNull();
    await expect(verify('tc_session=dead')).resolves.toBeNull();
    expect(refreshCalls()).toBe(1);
  });

  it('drops the memo once the grace window passes', async () => {
    // Installed before the refresh, so the eviction timer it schedules is a fake one.
    vi.useFakeTimers();
    const { workos, refreshCalls } = makeExpiredWorkos('user_refresh_3');
    const verify = verifierFor(workos);

    await verify('tc_session=sealed-expired');
    expect(refreshCalls()).toBe(1);

    await vi.advanceTimersByTimeAsync(60_000);

    // The entry is gone, so this one refreshes for itself — and fails, because
    // the token really was rotated. That is the correct outcome for a stale
    // cookie a minute later; the grace window only covers the near-simultaneous case.
    await expect(verify('tc_session=sealed-expired')).resolves.toBeNull();
    expect(refreshCalls()).toBe(2);
  });
});

describe('createSessionVerifier: operator lookup', () => {
  it('collapses concurrent lookups for one user into a single getUser', async () => {
    const gate = deferred<FakeUser>();
    const workos = makeAuthenticatedWorkos('op_concurrent', () => gate.promise);
    const verify = verifierFor(workos);

    const inFlight = Array.from({ length: 5 }, () => verify('tc_session=sealed'));
    await new Promise((r) => setImmediate(r));
    gate.resolve({ id: 'op_concurrent', email: 'op@acme.test', metadata: { role: 'operator' } });
    const results = await Promise.all(inFlight);

    expect(workos.userManagement.getUser).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r?.user.isOperator)).toEqual([true, true, true, true, true]);
  });

  // Without stamping the cache on failure, a WorkOS outage means every single
  // request re-attempts getUser at full rate.
  it('caches a failed lookup so the next request does not re-attempt it', async () => {
    const workos = makeAuthenticatedWorkos('op_failing', async () => {
      throw new Error('workos down');
    });
    const verify = verifierFor(workos);

    const first = await verify('tc_session=sealed');
    expect(first?.user.isOperator).toBe(false);

    const second = await verify('tc_session=sealed');
    expect(second?.user.isOperator).toBe(false);
    expect(workos.userManagement.getUser).toHaveBeenCalledTimes(1);
  });
});
