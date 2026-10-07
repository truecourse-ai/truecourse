/**
 * Concurrency knob shared by the scan's session pools. Each pool owns its own
 * limit; this is the default cap, env-overridable via
 * `TRUECOURSE_MAX_CONCURRENCY`.
 */

import os from 'node:os';

export function defaultConcurrency(): number {
  const env = process.env.TRUECOURSE_MAX_CONCURRENCY;
  if (env) {
    const parsed = parseInt(env, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return Math.min(os.cpus().length, 4);
}
