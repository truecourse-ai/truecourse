/**
 * Positive fixture for security/deterministic/hardcoded-secret.
 *
 * A PostHog public project API key (the `phc_…` prefix) is meant to ship in
 * client code so the browser can send analytics events — it is intentionally
 * public, not a private credential. Its 40+ char base62 body otherwise
 * collides with the generic Cohere-token shape, so the scanner must allowlist
 * the `phc_` prefix and not flag it.
 */

export const analyticsProjectKey = "phc_9fK2pQ7mWxZr4tLbN1cV8aH3eD6sJ0uYgQwRtZxMpK";
