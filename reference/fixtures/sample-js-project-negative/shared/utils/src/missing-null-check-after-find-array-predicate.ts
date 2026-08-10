/**
 * Paraphrased true-bug for reliability/deterministic/missing-null-check-after-find.
 *
 * `Array.prototype.find` returns `T | undefined`. Accessing a property
 * straight on its result without an optional-chain or guard will throw
 * when no element matches.
 */

interface Recipient {
  readonly id: number;
  readonly displayName: string;
}

export function recipientNameFor(
  recipients: ReadonlyArray<Recipient>,
  recipientId: number,
): string {
  // VIOLATION: reliability/deterministic/missing-null-check-after-find
  return recipients.find((r) => r.id === recipientId).displayName;
}
