/**
 * Negative fixture for security/deterministic/hardcoded-password-function-arg.
 *
 * A real plaintext credential passed straight into an authenticate call —
 * exactly the leak this rule is meant to catch.
 */

function authenticateUser(token: string): boolean {
  return token.length > 0;
}

// VIOLATION: security/deterministic/hardcoded-password-function-arg
export function login(): boolean {
  return authenticateUser("S3cretP0wer99");
}
