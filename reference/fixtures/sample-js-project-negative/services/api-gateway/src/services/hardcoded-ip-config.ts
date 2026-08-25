/**
 * Negative fixture for security/deterministic/hardcoded-ip.
 *
 * A real IPv4 address embedded directly in source — exactly the bug
 * pattern this rule is meant to catch.
 */

// VIOLATION: security/deterministic/hardcoded-ip
export const UPSTREAM_HOST = '192.168.42.17';
