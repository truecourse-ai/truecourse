/**
 * Positive fixture for bugs/deterministic/loss-of-precision.
 *
 * Wrapping a large integer literal in an explicit `BigInt(...)` conversion
 * signals the developer has opted into big-integer handling. The generic
 * "literal exceeds MAX_SAFE_INTEGER" warning is noise in that case, so the
 * rule must not fire on the argument of a `BigInt(...)` call.
 */

const LEDGER_BASE = BigInt(1000000000000000000);

export function defaultLedgerBalance(): bigint {
  return LEDGER_BASE;
}
