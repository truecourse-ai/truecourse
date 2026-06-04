/**
 * Positive fixture for code-quality/deterministic/missing-destructuring.
 *
 * Two shapes:
 *
 *   1. `process.env.X` extractions. Module bootstraps routinely pull
 *      env vars into UPPER_SNAKE constants, often with `|| "default"`
 *      fallbacks; destructuring `{ X } = process.env` is allowed by
 *      the spec but loses the per-var fallback and the readable
 *      one-line-per-var layout that ops engineers grep for.
 *
 *   2. Optional-chain property access (`payload.meta?.runId`).
 *      Destructuring optionals is awkward (`const { runId } =
 *      payload.meta ?? {}`) and obscures the optionality, which is
 *      load-bearing for the caller's null check.
 */

const HTTP_PORT = process.env.HTTP_PORT;
const HTTP_HOST = process.env.HTTP_HOST;
const HTTP_PROTOCOL = process.env.HTTP_PROTOCOL;
if (!HTTP_PORT || !HTTP_HOST || !HTTP_PROTOCOL) {
  throw new Error('HTTP_PORT, HTTP_HOST and HTTP_PROTOCOL are required');
}

interface Payload {
  meta?: { runId?: string; jobId?: string };
}

export function summarize(payload: Payload): string {
  const runId = payload.meta?.runId;
  const jobId = payload.meta?.jobId;
  return `${HTTP_PROTOCOL}://${HTTP_HOST}:${HTTP_PORT} ${runId}/${jobId}`;
}
