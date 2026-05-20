/**
 * Patterns that the prototype-pollution rule misclassifies:
 *
 *  1. Aggregating into a stats object using keys destructured from a
 *     callback parameter inside `forEach`/`map`. The keys come from a
 *     typed enum field of an iteration item, not from user input.
 *  2. A locally-managed numeric counter used as an array index (`arr[i++]`).
 *     A `number` index can never be `"__proto__"` / `"constructor"`.
 */

type RecipientRow = {
  readStatus: 'opened' | 'not_opened';
  signingStatus: 'signed' | 'pending';
  sendStatus: 'sent' | 'queued';
  count: number;
};

export function tallyRecipientStats(rows: ReadonlyArray<RecipientRow>): Record<string, number> {
  const stats: Record<string, number> = {};
  rows.forEach((row) => {
    const { readStatus, signingStatus, sendStatus, count } = row;
    stats[readStatus] = (stats[readStatus] ?? 0) + count;
    stats[signingStatus] = (stats[signingStatus] ?? 0) + count;
    stats[sendStatus] = (stats[sendStatus] ?? 0) + count;
  });
  return stats;
}

export function groupRowsByPage<T>(rows: ReadonlyArray<T>, capacity: number): T[][] {
  const grouped: T[][] = [[]];
  let currentRowIndex = 0;
  for (const row of rows) {
    if (grouped[currentRowIndex].length >= capacity) {
      currentRowIndex++;
      grouped[currentRowIndex] = [row];
    } else {
      grouped[currentRowIndex].push(row);
    }
  }
  return grouped;
}
