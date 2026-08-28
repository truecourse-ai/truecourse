/**
 * The auth gate: built from a verifier by `createAuthGate`, enforcing when it
 * has one and a transparent pass-through when handed `null` (the test seam).
 * The unit cases drive the factory directly; the integration cases mount a real
 * app to pin which routes sit in front of the gate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import type { AuthResult, AuthVerifier } from '@truecourse/shared';
import { createAuthGate } from '../../apps/dashboard/server/src/middleware/auth';
import { createApp } from '../../apps/dashboard/server/src/app';

function mkCtx(cookie?: string) {
  const req = { headers: { cookie } } as never as {
    headers: { cookie?: string };
    user?: unknown;
  };
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    cookies: [] as string[],
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
    append(name: string, value: string) {
      if (name === 'Set-Cookie') this.cookies.push(value);
      return this;
    },
  };
  const next = vi.fn();
  return { req, res, next };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function run(gate: ReturnType<typeof createAuthGate>, cookie?: string) {
  const ctx = mkCtx(cookie);
  await gate(ctx.req as any, ctx.res as any, ctx.next);
  return ctx;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('createAuthGate', () => {
  it('passes through when built with no verifier (the test seam)', async () => {
    const { next } = await run(createAuthGate(null));
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('401s when the verifier finds no user', async () => {
    const { res, next } = await run(createAuthGate(async () => null), 'x=1');
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('passes and attaches req.user when the verifier resolves a session', async () => {
    const user = { id: 'u1', email: 'a@b.com' };
    const { req, next } = await run(createAuthGate(async () => ({ user })), 'sess=abc');
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.user).toEqual(user);
  });

  it('applies a refreshed Set-Cookie when the session was renewed', async () => {
    const gate = createAuthGate(async () => ({
      user: { id: 'u1', email: 'a@b.com' },
      setCookie: 'tc_session=new; Path=/; HttpOnly',
    }));
    const { res, next } = await run(gate, 'sess=expired');
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.cookies).toContain('tc_session=new; Path=/; HttpOnly');
  });

  it('401s when the verifier throws', async () => {
    const gate = createAuthGate(async () => {
      throw new Error('boom');
    });
    const { res, next } = await run(gate, 'sess=abc');
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});

describe('createApp with a verifier', () => {
  const user = { id: 'u1', email: 'a@b.com' };
  const verify: AuthVerifier = async (cookieHeader) =>
    cookieHeader?.includes('tc_session=good') ? ({ user } satisfies AuthResult) : null;

  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    app = createApp({ serveStatic: false, authVerifier: verify });
  });

  it('401s a protected route without a session cookie', async () => {
    await request(app).get('/api/repos').expect(401);
  });

  it('serves a protected route with a valid session cookie', async () => {
    await request(app).get('/api/repos').set('Cookie', 'tc_session=good').expect(200);
  });

  // No allowlist lives in the gate — health and capabilities are public purely
  // because app.ts mounts them ABOVE the `app.use('/api', gate)` line.
  it('leaves health and capabilities reachable without a cookie', async () => {
    await request(app).get('/api/health').expect(200);
    await request(app).get('/api/capabilities').expect(200);
  });
});
