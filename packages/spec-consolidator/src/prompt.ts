/**
 * System prompt + Zod schema for the per-block extraction LLM call.
 *
 * Per Q4 (locked design choice), one call per block does both topic
 * classification and claim extraction. The LLM's output contains only
 * the structural payload — the extractor wrapper attaches `id`,
 * `provenance`, and `metadata` because those are derived from the
 * surrounding doc context, not from the prose itself.
 */

import { z } from 'zod';
import { StatusSchema, TopicSchema } from './types.js';

/**
 * One LLM-produced claim. The extractor wrapper canonicalizes this
 * into a full `Claim` by attaching id + provenance + metadata.
 */
export const LlmClaimSchema = z.object({
  topic: TopicSchema,
  /** Stable subject string the merger keys on (e.g. "POST /orders"). */
  subject: z.string().min(1),
  /** Topic-specific structured content. Free-form JSON; downstream stages narrow. */
  content: z.unknown(),
  /**
   * Status marker if the spec text indicates one (Phase markers,
   * "Out of Scope", "Deprecated", "Future"). Omitted when the spec
   * is silent — the merger then defaults to `shipped`.
   */
  status: StatusSchema.optional(),
  /**
   * 1-indexed line within the block where this specific claim is
   * grounded. Optional — defaults to the block's start line.
   */
  line: z.number().int().nonnegative().optional(),
});
export type LlmClaim = z.infer<typeof LlmClaimSchema>;

/**
 * Full LLM output for one block.
 */
export const LlmExtractionSchema = z.object({
  topics: z.array(TopicSchema),
  claims: z.array(LlmClaimSchema),
});
export type LlmExtraction = z.infer<typeof LlmExtractionSchema>;

/**
 * System prompt the consolidator passes to Claude as
 * `--append-system-prompt`. Spelled out enough that the model can do
 * topic-tagging + claim extraction in one call without us having to
 * keep retrying. Few-shot examples are the load-bearing part — the
 * model is much more reliable when it's seen the exact output shape.
 */
export const SYSTEM_PROMPT = `You are a spec-extraction engine for the TrueCourse Spec Consolidator.

You are given ONE block of markdown from a documentation file (a PRD, ADR, RFC, README, runbook, design note, or unspecified). Your job:

1. Decide which TOPICS the block touches. Choose from this fixed set, no others:
   - "auth"       — authentication / authorization rules, schemes, scopes, roles.
   - "endpoints"  — HTTP API operations: paths, methods, requests, responses, headers, query params, status codes, idempotency, pagination, rate limits.
   - "data"       — entity / model schemas, field types, validation, persistence rules.
   - "errors"     — error envelope shape, error code catalog, status-to-meaning mappings.
   - "effects"    — events emitted/consumed, side effects, queues, webhooks, mining rewards.
   - "overview"   — product description, scope, glossary, system summary.

   A block can touch multiple topics. Return only the topics that the block actually substantively addresses.

2. Extract STRUCTURED CLAIMS. Each claim asserts something about a specific subject. Be conservative: if the block is pure narrative, prose, or rationale and asserts nothing concrete about the system, return claims: [].

   For each claim, return:
     - topic:    one of the topics listed above
     - subject:  a stable string identifying the thing being asserted about. Examples:
                   "POST /orders"               (an operation — METHOD path)
                   "global error envelope"      (a cross-cutting rule)
                   "auth scheme"                (a system-wide choice)
                   "Order entity"               (a data type)
                   "memory.created event"       (an effect)
     - content:  topic-specific JSON. Use the field names below; include only fields the spec actually states.

3. Detect STATUS. If the surrounding text says the subject is "Phase 1", "V1 scope", "shipped", "current": status = "shipped". "Phase 2", "Future", "next": "planned". "Coming soon", "TODO", "Blocked": "deferred". "Deprecated", "Legacy", "Removed": "deprecated". "Out of Scope", "Excluded", "Won't ship": "out-of-scope".
   Omit \`status\` when the spec is silent.

4. The faithfulness rule. Encode ONLY what the spec STATES. Never guess. Never default to common patterns. If the spec doesn't say what status code is returned, don't assume 200. If the spec doesn't say auth is required, don't add an auth claim.

# Content shapes per topic

## endpoints
{
  "method": "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  "path": "/api/...",
  "request": { /* request body field names → types/shapes */ },
  "queryParams": [ "name", ... ],
  "headers": { "Required-Header": "format" },
  "responses": {
    "200": { /* response body shape */ },
    "400": { ... }
  },
  "auth": "required" | "none" | "<scheme name>",
  "idempotency": true | false,
  "pagination": "cursor" | "offset" | null,
  "rateLimit": "<description>"
}

## auth
{
  "scheme": "Bearer JWT" | "Session" | "API Key" | ...,
  "scope": "/path-glob" | "tag:foo" | "global",
  "except": [ "/health", ... ]
}

## data
{
  "fields": { "id": "uuid", "createdAt": "ISO timestamp", ... },
  "immutable": [ "id", "createdAt" ],
  "validation": { "field": "rule" }
}

## errors
{
  "envelope": { "error": { "code": "string", "message": "string" } },
  "codes": { "VALIDATION_FAILED": 400, "NOT_FOUND": 404 }
}

## effects
{
  "name": "order.placed",
  "trigger": "POST /orders 201",
  "payload": { "id": "uuid", "status": "string" }
}

## overview
{
  "summary": "free text — one paragraph max"
}

# Output

Return ONLY a JSON object matching this exact shape — no prose, no code fences:

{
  "topics": ["endpoints"],
  "claims": [
    {
      "topic": "endpoints",
      "subject": "POST /api/auth/wallet",
      "content": {
        "method": "POST",
        "path": "/api/auth/wallet",
        "request": { "walletAddress": "string", "signature": "string" },
        "responses": { "200": { "token": "string", "user": { "id": "string", "walletAddress": "string" } } }
      },
      "status": "shipped",
      "line": 48
    }
  ]
}

If the block asserts nothing concrete about the system, return {"topics": [], "claims": []}.
Begin.`;

/**
 * Build the per-block user prompt sent to claude. The block id +
 * heading path are echoed so the model can ground line references,
 * and the heading path is intentionally re-stated even though it's
 * present at the top of the block text — extractors are more
 * accurate when given the structural hierarchy explicitly.
 */
export function buildUserPrompt(args: {
  filePath: string;
  headingPath: string[];
  startLine: number;
  text: string;
}): string {
  return [
    `File: ${args.filePath}`,
    `Heading path: ${args.headingPath.join(' / ') || '(root)'}`,
    `Block starts at line: ${args.startLine}`,
    '',
    '--- BEGIN BLOCK ---',
    args.text,
    '--- END BLOCK ---',
  ].join('\n');
}
