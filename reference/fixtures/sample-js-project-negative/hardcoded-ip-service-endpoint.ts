/**
 * Negative fixture for security/deterministic/hardcoded-ip.
 *
 * A worker is pinned to a specific machine by a raw IPv4 address baked
 * into a URL instead of reading the host from configuration — exactly the
 * bug this rule is meant to catch.
 */

export function metricsEndpoint(): string {
  // VIOLATION: security/deterministic/hardcoded-ip
  return "https://203.0.113.10:9090/metrics";
}
