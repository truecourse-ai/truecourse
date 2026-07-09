/**
 * Negative fixture for bugs/deterministic/loss-of-precision.
 *
 * A bare integer literal beyond Number.MAX_SAFE_INTEGER silently loses
 * precision at runtime — the real bug this rule catches. There is no explicit
 * `BigInt(...)` conversion, so it must still be flagged.
 */

// VIOLATION: bugs/deterministic/loss-of-precision
export const externalAccountId = 9007199254740993;
