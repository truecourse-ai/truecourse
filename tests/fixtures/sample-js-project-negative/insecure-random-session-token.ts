/**
 * Negative fixture for security/deterministic/insecure-random.
 *
 * Math.random() is used to mint a session token — a security-sensitive value
 * that must be unpredictable. Math.random() is not cryptographically secure,
 * so an attacker who can observe or predict its output can forge session
 * tokens. This is the real bug the rule must catch.
 */

export function createSessionToken(): string {
  // VIOLATION: security/deterministic/insecure-random
  const sessionToken = Math.random().toString(36).slice(2)
  return sessionToken
}
