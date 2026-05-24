/**
 * Positive fixture for bugs/deterministic/await-in-loop.
 *
 * Three FP shapes covered:
 *
 *   1. Awaits inside an ORM transaction callback (`db.$transaction(async
 *      (tx) => { for (...) { await tx.X(...) } })`). All queries against
 *      the same transaction must run sequentially against one connection —
 *      `Promise.all` against the tx is a bug, not a perf win.
 *
 *   2. "Search until found" loop where the awaited result is checked by an
 *      `if (...) return / break / throw`. Parallelising would
 *      speculatively waste work on iterations that early-exit would skip.
 *
 *   3. Iterator-protocol reads (`reader.read()`, `iter.next()`) — the
 *      iterator's position advances after each call; the calls are not
 *      independent and there is no parallel form.
 */

declare const db: {
  $transaction: <T>(cb: (tx: {
    record: { create: (args: { data: unknown }) => Promise<void> };
  }) => Promise<T>) => Promise<T>;
};
declare function makeOtp(seed: string, counter: number): Promise<string>;

interface ChunkReader {
  read(): Promise<{ done: boolean; value?: string }>;
}

declare function getChunkReader(): ChunkReader;

export async function persistAll(items: ReadonlyArray<{ id: string }>): Promise<void> {
  await db.$transaction(async (tx) => {
    for (const item of items) {
      await tx.record.create({ data: item });
    }
  });
}

export async function findValidOtp(
  seed: string,
  code: string,
  windowSize: number,
  period: number,
): Promise<boolean> {
  let now = Date.now();
  for (let i = 0; i < windowSize; i++) {
    const counter = Math.floor(now / period);
    const otp = await makeOtp(seed, counter);
    if (otp === code) {
      return true;
    }
    now -= period;
  }
  return false;
}

export async function countChunks(): Promise<number> {
  const reader = getChunkReader();
  let n = 0;
  let done = false;
  while (!done) {
    const result = await reader.read();
    done = result.done;
    if (done) break;
    if (result.value) n += 1;
  }
  return n;
}
