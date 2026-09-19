/**
 * The model OPERATOR MODE runs on.
 *
 * ONE MODEL EVERYWHERE. A workspace on an API provider names one model on the
 * Models page and every call and every session of its runs uses it. Operator
 * mode — this process's own `claude` login — has no such page, so it takes its
 * model from here, and it is one model too: the same for every call and every
 * session, whatever the work.
 *
 *   1. `TRUECOURSE_MODEL`, when the operator names one
 *   2. {@link DEFAULT_OPERATOR_MODEL}
 *
 * `TRUECOURSE_FALLBACK_MODEL` is the separate question of what to RETRY on when
 * the primary is overloaded.
 */

/** What operator mode runs on when `TRUECOURSE_MODEL` names nothing. */
export const DEFAULT_OPERATOR_MODEL = 'opus';

/** The one model operator mode runs every call and every session on. */
export function resolveModel(): string {
  const env = process.env.TRUECOURSE_MODEL;
  return env && env.trim() ? env.trim() : DEFAULT_OPERATOR_MODEL;
}

/** What to retry with when the primary is overloaded, or null when unset. */
export function resolveFallbackModel(): string | null {
  const env = process.env.TRUECOURSE_FALLBACK_MODEL;
  return env && env.trim() ? env.trim() : null;
}
