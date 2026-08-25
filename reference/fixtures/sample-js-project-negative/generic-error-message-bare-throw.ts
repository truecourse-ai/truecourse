/**
 * Negative fixture for bugs/deterministic/generic-error-message.
 *
 * A bare vague message thrown with no error code or actionable detail — the
 * unhelpful pattern this rule is meant to catch.
 */

export function loadProfile(): never {
  // VIOLATION: bugs/deterministic/generic-error-message
  throw new Error("Something went wrong");
}
