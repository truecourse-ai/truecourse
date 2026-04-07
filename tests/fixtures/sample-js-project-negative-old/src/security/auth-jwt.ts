/**
 * Security violations related to JWT and authentication.
 */

const jwt = { sign: (payload: any, secret: string, opts?: any) => 'token', verify: (token: string, secret: string, opts?: any) => ({}) };

// VIOLATION: security/deterministic/insecure-jwt
export function insecureJwt() {
  return jwt.sign({ userId: 1 }, 'secret', { algorithm: 'none' });
}

// VIOLATION: security/deterministic/jwt-no-expiry
export function jwtNoExpiry() {
  return jwt.sign({ userId: 1 }, 'secret');
}

// VIOLATION: security/deterministic/jwt-no-expiry
export function jwtNoExpiryWithOptions() {
  return jwt.sign({ userId: 1 }, 'secret', { algorithm: 'RS256' });
}

// VIOLATION: security/deterministic/long-term-aws-keys-in-code
export function longTermAwsKeysInCode() {
  const accessKeyId = 'AKIAIOSFODNN7EXAMPLE';
  return { accessKeyId };
}

// VIOLATION: security/deterministic/timing-attack-comparison
export function timingAttackComparison(userToken: string, storedToken: string) {
  if (userToken === storedToken) {
    return true;
  }
  return false;
}

// VIOLATION: security/deterministic/user-id-from-request-body
export function userIdFromRequestBody(req: any) {
  const userId = req.body.userId;
  return userId;
}
