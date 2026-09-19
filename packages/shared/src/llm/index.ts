/**
 * `@truecourse/shared/llm` — what a package needs to ASK a model something and
 * read the answer, without knowing how it is asked.
 *
 * Every LLM call the product makes is a turn of an agent session, on the
 * `SessionDriver` seam in `@truecourse/agent-loop`. What is left here is the
 * content half, which no package owns alone: the prompt guardrail, the shape a
 * reply is rendered to and parsed out of, and the per-kind failure tally a run
 * reports when the provider lost everything.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ZodTypeAny } from 'zod';

// Re-exported here so every output-only prompt reaches it through the same
// `@truecourse/shared/llm` entry it already imports the rest from.
export { OUTPUT_ONLY_GUARDRAIL } from './guardrail.js';
export {
  StageTransportTallySchema,
  LlmStageFailureError,
  formatStageFailure,
  isSystemicTally,
  MAX_TALLY_ERROR_CHARS,
  type StageTransportTally,
} from './tally.js';

/**
 * Strip a single leading ```...``` fence (some models wrap JSON in fences even
 * when told not to). Shared so every reader strips identically.
 */
export function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fence ? fence[1] : trimmed;
}

/**
 * Extract the first balanced JSON value (`{…}` or `[…]`) from a model response,
 * robust to the ways weaker models wrap it: ```json fences (closed or not),
 * content on the same line as the fence, and trailing prose AFTER the JSON
 * ("…here is the JSON. Note: these are design choices, not specs."). The strict
 * `stripCodeFences` only matches a cleanly-fenced block, so a chatty response
 * left the fence in and `JSON.parse` choked on the leading backtick.
 *
 * Scans string/escape-aware so brackets inside string values don't throw off
 * the depth count. Returns the raw substring (caller still parses + validates);
 * falls back to the fence-stripped text when no bracket is found.
 */
export function extractJsonValue(text: string): string {
  const body = stripCodeFences(text);
  const start = body.search(/[[{]/);
  if (start === -1) return body;
  const open = body[start];
  const close = open === '[' ? ']' : '}';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return body.slice(start); // unbalanced (truncated) — best effort for the caller
}

/**
 * Render a Zod schema as a JSON-schema STRING a prompt can state as its output
 * contract — the same Zod definition the answer is then validated against, so
 * the contract and the check can never drift apart.
 *
 * `$refStrategy: 'none'` INLINES every reused sub-schema rather than emitting a
 * `$ref`. zod-to-json-schema's default refs a reused sub-schema by its first
 * path (e.g. `#/properties/topics/items`), but provider structured-output
 * validators require `$ref`s under `$defs`/`definitions` and reject the rest
 * ("References must be defined under '$defs'…") — which fails the whole call.
 * Inlining sidesteps it; these extraction schemas are flat DTOs, not recursive.
 *
 * `definitions` opts a DEEPLY-SHARED schema out of that inlining: each named
 * sub-schema renders once under `definitions` and is referenced everywhere it
 * recurs. Without it the web scenario schema — whose locator union (with its
 * 80-role enum) recurs in every verb, expectation, and capture — renders at
 * ~119K characters; named, it is ~18K. Callers without `definitions` get the
 * exact bytes they always did, so every existing prompt fingerprint holds.
 */
export function jsonSchemaHint(schema: ZodTypeAny, definitions?: Record<string, ZodTypeAny>): string {
  if (definitions) {
    return JSON.stringify(zodToJsonSchema(schema, { $refStrategy: 'root', definitions }));
  }
  return JSON.stringify(zodToJsonSchema(schema, { $refStrategy: 'none' }));
}
