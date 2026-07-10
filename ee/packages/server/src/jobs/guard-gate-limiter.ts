/**
 * Guard-gate concurrency limiter: a plain counting semaphore that caps how many
 * gate EXECUTOR runs (build + scenario children) are in flight at once across
 * the process — clone, LLM calls, and Check posting all happen outside the
 * permit, so a queued gate still makes progress while another repo builds.
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

/** Max concurrent gate executor runs per process (`TRUECOURSE_GUARD_GATE_CONCURRENCY`,
 *  default 2). Only finite values ≥ 1 are honored (floats floor to a whole permit
 *  count) — anything else falls back to 2, because a semaphore with a non-positive
 *  max would never grant a permit and every gate would deadlock. */
const rawMaxConcurrency = Number(process.env.TRUECOURSE_GUARD_GATE_CONCURRENCY);
export const GUARD_GATE_MAX_CONCURRENCY =
  Number.isFinite(rawMaxConcurrency) && rawMaxConcurrency >= 1
    ? Math.floor(rawMaxConcurrency)
    : 2;

/** The process-wide limiter every gate job shares. */
export const guardGateLimiter: Semaphore = createSemaphore(GUARD_GATE_MAX_CONCURRENCY);
