// Paraphrased TP example for bugs/deterministic/argument-type-mismatch.
//
// Real argument-type / overload-resolution mismatch — TypeScript emits
// TS2345 (or TS2769 on overloaded signatures), which is exactly the
// signal this rule is meant to surface.

interface Recipient {
  readonly id: number;
  readonly displayName: string;
}

function describeRecipient(name: string): string {
  return `recipient: ${name}`;
}

export function summarize(r: Recipient): string {
  // VIOLATION: bugs/deterministic/argument-type-mismatch
  return describeRecipient(r.id);
}
