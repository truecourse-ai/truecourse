
// Wave-M26: Promise.all(callbacks.map(async (cb) => cb())) — array of async flush callbacks
declare const pendingFlushCallbacks: Array<() => Promise<void>>;

async function flushAllCallbacks() {
  await Promise.all(pendingFlushCallbacks.map(async (flush) => flush()));
}



// --- FP shape: while-loop queue drainer — must process saves in FIFO order ---
declare function persistChange(payload: { key: string; data: unknown }): Promise<void>;
declare const saveQueue: Array<{ key: string; data: unknown }>;

async function drainSaveQueue(): Promise<void> {
  while (saveQueue.length > 0) {
    const next = saveQueue.shift();
    if (!next) break;
    await persistChange(next);
  }
}



// --- FP shape: ref.current set true (lock acquire), then false after async drain (lock release) ---
declare function flushPendingUpdates(): Promise<void>;
declare const pendingQueue: unknown[];

const isFlushingRef = { current: false };

async function scheduleFlush(): Promise<void> {
  if (isFlushingRef.current) return;
  isFlushingRef.current = true;
  try {
    while (pendingQueue.length > 0) {
      await flushPendingUpdates();
    }
  } finally {
    isFlushingRef.current = false;
  }
}
