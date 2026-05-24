// True bug pattern: asserting a value as a more specific runtime type
// without any narrowing. The compiler trusts the assertion, but at
// runtime the value can be a wholly different shape — the rule should
// keep firing on these.

type Envelope = { id: string; payload: unknown };

export function readEnvelopeName(envelope: Envelope): string {
  // VIOLATION: bugs/deterministic/unsafe-type-assertion
  return envelope.payload as string;
}

export function coerceCount(value: number | undefined): number {
  // VIOLATION: bugs/deterministic/unsafe-type-assertion
  return value as number;
}
