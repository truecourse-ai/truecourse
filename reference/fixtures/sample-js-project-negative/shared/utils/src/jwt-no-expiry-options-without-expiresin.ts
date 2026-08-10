/**
 * jwt.sign called with an options object that omits expiresIn — token
 * never expires. The rule should still flag this when options are passed.
 */

const jwt = {
  sign: (payload: unknown, secret: string, opts?: Record<string, unknown>): string => 'token',
};

export function issueSessionToken(userId: string): string {
  // VIOLATION: security/deterministic/jwt-no-expiry
  return jwt.sign({ userId }, 'session-secret', { algorithm: 'HS256' });
}

export function issueServiceToken(serviceId: string): string {
  // VIOLATION: security/deterministic/jwt-no-expiry
  return jwt.sign({ serviceId }, 'service-secret', { algorithm: 'HS512' });
}
