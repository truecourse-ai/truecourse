/**
 * A plain counting semaphore for capping how many instances of one expensive
 * job phase run at once inside a process — a job whose permit isn't free waits
 * without blocking the rest of its body (clone, LLM calls, reporting all happen
 * outside the permit, so a queued run still makes progress).
 */

export interface Semaphore {
  /** Run `fn` once a permit is free; the permit is released on resolve AND reject. */
  run<T>(fn: () => Promise<T>): Promise<T>;
}

export function createSemaphore(max: number): Semaphore {
  let active = 0;
  const waiters: Array<() => void> = [];

  const acquire = (): Promise<void> => {
    if (active < max) {
      active++;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiters.push(() => resolve()));
  };

  const release = (): void => {
    const next = waiters.shift();
    if (next) next(); // hand the permit straight to the next waiter
    else active--;
  };

  return {
    async run(fn) {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
  };
}
