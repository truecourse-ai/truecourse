/**
 * Positive fixture for performance/deterministic/unbounded-array-growth.
 *
 * The "advancing iterator until threshold" loop shape is bounded by a
 * strict ordering comparison (`<`, `<=`, `>`, `>=`) on a value that is
 * re-assigned inside the loop body. Cron schedulers, time-window
 * paginators, and integer counters all match this shape, and the
 * push is guaranteed to stop. The rule must not flag it.
 */

interface DateCursor {
  toDate(): Date;
  advance(): void;
}

export function collectDueTicks(cursor: DateCursor, now: Date): Date[] {
  const ticks: Date[] = [];
  let current = cursor;
  while (current.toDate() <= now) {
    ticks.push(current.toDate());
    current = nextCursor(current);
  }
  return ticks;
}

function nextCursor(cursor: DateCursor): DateCursor {
  cursor.advance();
  return cursor;
}

export function takeNumbersUpTo(start: number, limit: number): number[] {
  const out: number[] = [];
  let i = start;
  while (i < limit) {
    out.push(i);
    i = i + 1;
  }
  return out;
}
