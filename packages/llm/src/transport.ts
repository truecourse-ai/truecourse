/**
 * The LLM transport seam. Every structured LLM call in TrueCourse — contract
 * extraction, spec consolidation, violation generation — goes through a single
 * primitive: a prompt + a Zod schema in, a validated object (+ usage) out.
 *
 * The OSS default (`cliTransport`) spawns the local `claude` binary. The
 * enterprise edition installs an AI-SDK-backed transport (`setLlmTransport`)
 * that talks to Anthropic/OpenAI/Bedrock/Copilot over their APIs instead — so
 * a hosted deploy never depends on a CLI binary. Callers don't know or care
 * which is active.
 */

import type { ZodTypeAny } from 'zod';

/** The parsed (post-default, post-transform) output type of a Zod schema. */
export type Inferred<S extends ZodTypeAny> = S['_output'];

export interface CompleteUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
  /** Provider-reported cost in USD, when available. */
  costUsd?: string;
}

export interface CompleteRequest<S extends ZodTypeAny = ZodTypeAny> {
  /** Optional system prompt (instructions / persona). */
  system?: string;
  /** The user prompt — the content to reason over. */
  prompt: string;
  /** Zod schema the model output must satisfy; the transport validates against it. */
  schema: S;
  /** Resolved model id (a CLI model name, or a provider-specific id). */
  model?: string;
  /** Optional fallback model id. Honored by the CLI transport. */
  fallbackModel?: string;
  /** Per-call timeout in milliseconds. */
  timeoutMs?: number;
  /** Cooperative cancellation. */
  signal?: AbortSignal;
  /** Short label for logs/debug. */
  label?: string;
  /**
   * Extra CLI flags appended verbatim — honored ONLY by the CLI transport and
   * ignored by API transports. Lets a caller preserve a flag it relied on
   * (e.g. `--setting-sources project`) without leaking CLI semantics elsewhere.
   */
  cliArgs?: string[];
  /**
   * CLI transport only: pass the schema to `claude` via `--json-schema` for
   * server-side enforcement. Off by default — most callers convey the shape in
   * the prompt and validate the returned `result` text with the Zod schema
   * client-side (some schemas, e.g. tuples, aren't expressible in the draft the
   * flag requires). Ignored by API transports, which always enforce the schema.
   */
  cliJsonSchema?: boolean;
}

export interface CompleteResult<T> {
  object: T;
  usage?: CompleteUsage;
}

/** A free-text (prose) completion request — no schema. */
export interface CompleteTextRequest {
  system?: string;
  prompt: string;
  model?: string;
  fallbackModel?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  label?: string;
  /** CLI-transport-only extra flags; ignored by API transports. */
  cliArgs?: string[];
}

export interface CompleteTextResult {
  text: string;
  usage?: CompleteUsage;
}

/** A pluggable LLM transport: prompt (+ optional schema) → validated object or prose. */
export interface LlmTransport {
  /** Structured completion: the result is validated against the Zod schema. */
  complete<S extends ZodTypeAny>(
    req: CompleteRequest<S>,
  ): Promise<CompleteResult<Inferred<S>>>;
  /** Free-text completion: returns the model's prose unparsed. */
  completeText(req: CompleteTextRequest): Promise<CompleteTextResult>;
}
