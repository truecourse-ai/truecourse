/**
 * Direct equality comparison between a user-provided secret string and a
 * stored one. Vulnerable to timing attacks.
 */

export function authenticateApiKey(provided: string, expected: string): boolean {
  const apiKey = provided;
  const expectedApiKey = expected;
  // VIOLATION: security/deterministic/timing-attack-comparison
  return apiKey === expectedApiKey;
}
