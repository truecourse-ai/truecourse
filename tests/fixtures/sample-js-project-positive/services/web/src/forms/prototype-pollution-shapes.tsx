/**
 * prototype-pollution shape that should NOT fire:
 *
 * Aggregator over a typed-row array. The bucket key is
 * destructured via `const { readStatus, ... } = row` from a
 * forEach callback parameter — the field is statically typed
 * as a string-literal union (Prisma enum / TS literal union),
 * not user input. `__proto__` is not a possible value.
 */

type ReadStatus = "READ" | "UNREAD";
type SigningStatus = "SIGNED" | "PENDING";

interface Row {
  readonly readStatus: ReadStatus;
  readonly signingStatus: SigningStatus;
  readonly _count: number;
}

declare const rows: ReadonlyArray<Row>;

export function aggregateStats(): Record<string, number> {
  const stats: Record<string, number> = {
    READ: 0,
    UNREAD: 0,
    SIGNED: 0,
    PENDING: 0,
  };

  rows.forEach((row) => {
    const { readStatus, signingStatus, _count } = row;
    stats[readStatus] += _count;
    stats[signingStatus] += _count;
  });

  return stats;
}
