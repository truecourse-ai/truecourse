/**
 * await-in-loop shapes that should NOT fire:
 *
 * - `await Promise.all([...])` inside a loop — the await IS the
 *   parallel batch; the loop iterates over batches, not per-item.
 * - Queue-drain loops (`while (q.length)` + `q.shift()`) — the
 *   serialization is the explicit contract.
 * - `await sleep(BACKOFF_MS)` — intentional throttle / delay.
 */

declare const fetchOne: (id: string) => Promise<{ id: string }>;
declare const sleep: (ms: number) => Promise<void>;

const BATCH_SIZE = 10;
const POLL_ATTEMPTS = 5;
const BACKOFF_MS = 100;

export async function fetchInBatches(
  ids: ReadonlyArray<string>,
): Promise<ReadonlyArray<{ id: string }>> {
  const out: Array<{ id: string }> = [];
  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(fetchOne));
    out.push(...results);
  }
  return out;
}

export async function drainQueue(initial: ReadonlyArray<string>): Promise<void> {
  const queue: string[] = [...initial];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next) await fetchOne(next);
  }
}

export async function pollWithBackoff(): Promise<void> {
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    await sleep(BACKOFF_MS);
  }
}
