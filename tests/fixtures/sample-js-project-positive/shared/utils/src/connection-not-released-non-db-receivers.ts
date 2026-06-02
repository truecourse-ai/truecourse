interface Limiter {
  acquire(req: { readonly key: string }): Promise<{ token: string }>;
}

interface DistributedLock {
  acquire(
    resources: readonly string[],
    ttl: number,
  ): Promise<{ release(): Promise<void> }>;
}

const RATE_LIMIT_KEY = "tenant-1";
const LOCK_TTL_MS = 5000;

export async function reserveQuerySlot(
  queryConcurrencyLimiter: Limiter,
): Promise<string> {
  const slot = await queryConcurrencyLimiter.acquire({ key: RATE_LIMIT_KEY });
  return slot.token;
}

export async function takeRedlock(
  redlock: DistributedLock,
  resources: readonly string[],
): Promise<void> {
  const lock = await redlock.acquire(resources, LOCK_TTL_MS);
  await lock.release();
}
