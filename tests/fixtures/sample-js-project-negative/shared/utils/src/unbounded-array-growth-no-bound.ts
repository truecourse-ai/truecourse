// True bug pattern: push inside a while-loop with no threshold and
// no pruning. The condition references a flag that the body never
// updates, so each iteration just keeps growing the list.

export function drainPending(getEvent: () => string | null, isOpen: () => boolean): string[] {
  const events: string[] = [];
  // VIOLATION: performance/deterministic/unbounded-array-growth
  while (isOpen()) {
    const next = getEvent();
    if (next !== null) {
      events.push(next);
    }
  }
  return events;
}

export function tailForever(producer: () => string): string[] {
  const buf: string[] = [];
  // VIOLATION: performance/deterministic/unbounded-array-growth
  while (true) {
    buf.push(producer());
  }
}
