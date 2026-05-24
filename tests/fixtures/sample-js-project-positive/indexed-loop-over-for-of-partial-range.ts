// A counted loop whose upper bound is *not* `arr.length` (a count, an
// externally-tracked cursor, etc.) does only a partial pass over the array.
// `for...of` would iterate every element, changing the loop's range and its
// behavior. Such loops aren't mechanical for-of conversions.

interface Recipient {
  signingStatus: string
}

export function isCurrentRecipientTurn(
  recipients: readonly Recipient[],
  currentRecipientIndex: number,
): boolean {
  for (let i = 0; i < currentRecipientIndex; i++) {
    if (recipients[i].signingStatus !== 'SIGNED') {
      return false
    }
  }
  return true
}

export function firstNNonZero(values: readonly number[], n: number): number {
  let found = 0
  for (let i = 0; i < n; i++) {
    if (values[i] !== 0) {
      found += 1
    }
  }
  return found
}
