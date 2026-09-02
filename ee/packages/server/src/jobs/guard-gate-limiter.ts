/**
 * Guard-gate concurrency limiter: the process-wide semaphore capping how many
 * gate EXECUTOR runs (build + scenario children) are in flight at once — clone,
 * LLM calls, and Check posting all happen outside the permit, so a queued gate
 * still makes progress while another repo builds.
 */

import { createSemaphore, type Semaphore } from '@truecourse/jobs';

export { createSemaphore, type Semaphore };

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
