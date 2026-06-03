/**
 * Real base-to-string bug — calling `.toString()` on a plain object
 * yields the literal string `"[object Object]"`. The caller almost
 * certainly meant to serialise the object instead.
 */

export function logPayload(payload: { id: string; size: number }): string {
  // VIOLATION: bugs/deterministic/base-to-string
  return 'received: ' + payload.toString();
}
