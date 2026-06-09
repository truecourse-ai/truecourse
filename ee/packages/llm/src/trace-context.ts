/**
 * Ambient LLM trace context (enterprise observability).
 *
 * The transport (`createAiSdkTransport`) sees each `LlmRequest` — which carries
 * `id`/`stage` but NOT the EE-only facts (which org, which job, which repo).
 * Those come from here: the EE worker wraps each job body in `runWithTrace(...)`,
 * and the transport reads `currentTrace()` to tag the trace it records. Pure EE —
 * set by the worker, read by the transport; OSS never touches it.
 *
 * `AsyncLocalStorage` propagates across the concurrent slice awaits, so every
 * call of one job shares the same `traceId` without threading a parameter through
 * the OSS pipeline.
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
