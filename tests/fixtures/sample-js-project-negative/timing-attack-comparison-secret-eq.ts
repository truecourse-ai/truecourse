/**
 * Negative fixture for security/deterministic/timing-attack-comparison.
 *
 * Comparing a supplied token against the stored one with `===` short-circuits
 * on the first differing byte, so response time leaks how long a prefix
 * matched — an attacker can recover the secret byte by byte. This is the real
 * bug the rule catches; secrets must be compared in constant time.
 */

export function tokenMatches(providedToken: string, storedToken: string): boolean {
  // VIOLATION: security/deterministic/timing-attack-comparison
  return providedToken === storedToken;
}
