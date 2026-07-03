/**
 * Negative fixture for security/deterministic/hardcoded-secret.
 *
 * A genuine private API token hardcoded in source — the real bug this rule
 * catches. Unlike a PostHog public `phc_` key, this is a private credential
 * with no public-prefix carve-out, so it must still be flagged.
 */

// VIOLATION: security/deterministic/hardcoded-secret
export const inferenceApiToken = "kP3xQ9mViBn7sL0wRt2YfHdZ4aJ8cElNgUoPbT6kMqAvD";
