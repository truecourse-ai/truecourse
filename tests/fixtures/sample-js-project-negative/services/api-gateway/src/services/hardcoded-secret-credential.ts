/**
 * Negative fixture for security/deterministic/hardcoded-secret.
 *
 * Variable name says "token" and the value is a high-entropy mixed-case
 * string with digits — exactly the credential-shaped pattern the
 * variable-name fallback is meant to catch.
 */

// VIOLATION: security/deterministic/hardcoded-secret
export const apiToken = 'x9fK3jdf83HsJd92AcBnK0';
