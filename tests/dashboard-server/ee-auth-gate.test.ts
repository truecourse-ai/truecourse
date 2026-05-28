/**
 * The enterprise auth gate: transparent in community (no verifier),
 * enforcing in enterprise. Unit-tested against the middleware directly
 * with a mocked verifier source so we don't need a real session layer.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const verifierImpl = vi.fn();
vi.mock('../../apps/dashboard/server/src/ee-loader', () => ({
  // Returns the current verifier (a function) or null for community.
  getAuthVerifier: () => verifierImpl(),
}));

import { enterpriseAuthGate } from '../../apps/dashboard/server/src/middleware/ee-auth';

function mkCtx(cookie?: string) {
  const req = { headers: { cookie } } as never as {
    headers: { cookie?: string };
    eeUser?: unknown;
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

describe('enterpriseAuthGate', () => {
  beforeEach(() => verifierImpl.mockReset());

  it('passes through when there is no verifier (community)', async () => {
    verifierImpl.mockReturnValue(null);
    const { req, res, next } = mkCtx();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enterpriseAuthGate(req as any, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('401s when the verifier finds no user', async () => {
    verifierImpl.mockReturnValue(async () => null);
    const { req, res, next } = mkCtx('x=1');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enterpriseAuthGate(req as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('passes and attaches req.eeUser when the verifier resolves a session', async () => {
    const user = { id: 'u1', email: 'a@b.com' };
    verifierImpl.mockReturnValue(async () => ({ user }));
    const { req, res, next } = mkCtx('sess=abc');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enterpriseAuthGate(req as any, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(req.eeUser).toEqual(user);
  });

  it('applies a refreshed Set-Cookie when the session was renewed', async () => {
    const user = { id: 'u1', email: 'a@b.com' };
    verifierImpl.mockReturnValue(async () => ({
      user,
      setCookie: 'tc_session=new; Path=/; HttpOnly',
    }));
    const { req, res, next } = mkCtx('sess=expired');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enterpriseAuthGate(req as any, res as any, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.cookies).toContain('tc_session=new; Path=/; HttpOnly');
  });

  it('401s when the verifier throws', async () => {
    verifierImpl.mockReturnValue(async () => {
      throw new Error('boom');
    });
    const { req, res, next } = mkCtx('sess=abc');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await enterpriseAuthGate(req as any, res as any, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });
});
