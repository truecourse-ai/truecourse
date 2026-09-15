/**
 * Ambient LLM trace context.
 *
 * The transport (`createApiTransport`) sees each `LlmRequest` — which carries
 * `id`/`stage` but not which org, which job or which repo asked. Those come from
 * here: a caller wraps the job body in `runWithTrace(...)` and the transport
 * reads `currentTrace()` to tag the trace it records. Nothing does today, so
 * `currentTrace()` is `undefined` and nothing is recorded.
 *
 * `AsyncLocalStorage` propagates across the concurrent slice awaits, so every
 * call of one job would share the same `traceId` without threading a parameter
 * through the pipeline.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface TraceContext {
  /** Tenant (WorkOS org). */
  org: string | null;
  /** Groups every call of this operation — the worker uses the jobId. */
  traceId: string;
  jobId: string | null;
  repoFullName: string | null;
  commitSha: string | null;
  /** Parent call, when nesting (currently unused; reserved for repair → source). */
  parentId: string | null;
}

const storage = new AsyncLocalStorage<TraceContext>();

/** Run `fn` with `ctx` as the ambient trace context for every LLM call inside it. */
export function runWithTrace<T>(ctx: TraceContext, fn: () => Promise<T>): Promise<T> {
  return storage.run(ctx, fn);
}

/** The ambient trace context, or `undefined` outside any `runWithTrace`. */
export function currentTrace(): TraceContext | undefined {
  return storage.getStore();
}
