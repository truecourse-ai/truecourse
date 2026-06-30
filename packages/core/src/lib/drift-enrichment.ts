/**
 * On-demand, cached LLM enrichment of contract drifts into human-readable prose.
 *
 * A drift carries structured `specSide` / `codeSide` snippets and a terse
 * `message` — precise but not friendly. This service turns one drift into three
 * plain sentences (what the spec REQUIRES, what the code DOES, and a one-line
 * combined summary) for the human-facing surfaces (the gate PR comment, the
 * dashboard drift detail) while the structured original stays the AI/query
 * anchor — callers keep `message`/`specSide`/`codeSide` and only ADD the prose.
 *
 * Enrichment is NOT run at verify time. It's invoked on demand by whatever is
 * about to render a drift, and it DEGRADES GRACEFULLY:
 *   - no process-wide LLM transport configured (OSS, or EE before boot) → null,
 *     so the caller renders the structured snippets unchanged;
 *   - transport / parse / timeout failure → null (per-drift), never throws.
 *
 * Results are CONTENT-ADDRESSED and repo-agnostic: the cache key is a sha256 of
 * a prompt fingerprint + the drift's identifying content, so the same drift
 * (across repos, runs, the gate, and the dashboard) hits the same cache entry.
 * Changing the prompt rotates `PROMPT_FINGERPRINT` and invalidates stale entries.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { getDefaultTransport, stripCodeFences } from '@truecourse/shared/llm';

/**
 * The subset of a drift the enrichment reads. Structurally compatible with
 * `ContractDrift` (contract-verifier) / `GateDrift` (github-app) so callers pass
 * the drift straight through. Repo-agnostic on purpose — no ids, no line numbers.
 */
export interface DriftLike {
  artifactRef: { type: string; identity: string };
  obligationKey: string;
  message: string;
  severity: string;
  specSide?: string;
  codeSide?: string;
  specOrigin?: { file?: string; section?: string } | unknown;
}

/** The readable prose produced for one drift. Never replaces the structured original. */
export interface EnrichedDrift {
  /** One plain sentence: what the spec REQUIRES. */
  specReadable: string;
  /** One plain sentence: what the code ACTUALLY DOES. */
  codeReadable: string;
  /** One sentence combining both ("Spec requires X, but the code does Y."). */
  summary: string;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const DRIFT_ENRICHMENT_SYSTEM_PROMPT = `You translate a single contract "drift" into plain, human-readable prose.

A drift is a mismatch between what a documented specification REQUIRES and what
the implementation code ACTUALLY DOES. You are given the structured details of
ONE drift (the artifact, the obligation, a terse machine message, and optional
spec-side / code-side snippets).

Return ONLY a JSON object, no prose, no markdown, no code fences:

  {
    "specReadable": "<one plain sentence: what the SPEC requires>",
    "codeReadable": "<one plain sentence: what the CODE actually does>",
    "summary": "<one sentence combining both, of the form 'Spec requires X, but the code does Y.'>"
  }

Rules:
  - Write for a developer reading a PR comment. Concrete, specific, no hedging.
  - One sentence each. No bullet lists, no headings, no fences.
  - Name the artifact (e.g. the endpoint, entity, or enum) when it clarifies.
  - "specReadable" describes the requirement; "codeReadable" describes the
    observed behaviour; "summary" contrasts them in a single sentence.
  - Do not invent facts beyond what the drift states. If a side is unknown, say so plainly.`;

/**
 * Rotates whenever the prompt changes, invalidating stale cache entries. Mirrors
 * the `PROMPT_FINGERPRINT` convention used across the spec-consolidator LLM
 * stages and `contract-extractor/cache.ts`.
 */
const PROMPT_FINGERPRINT = createHash('sha256')
  .update(DRIFT_ENRICHMENT_SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 16);

// ---------------------------------------------------------------------------
// Cache seam — content-addressed, repo-agnostic
// ---------------------------------------------------------------------------

/** Stable, repo-independent scope: the key is fully content-addressed. */
const CACHE_SCOPE = 'drift-enrichment';
const CACHE_NAME = 'drift';

/**
 * The content-addressed cache key for a drift. EXPORTED so every caller (the
 * gate comment, the dashboard enrich endpoint) derives the SAME key and shares
 * cache hits. Stable across repos/runs: it hashes only the prompt fingerprint
 * plus the drift's identifying content — no ids, no line numbers.
 */
export function driftContentKey(d: DriftLike): string {
  return createHash('sha256')
    .update(PROMPT_FINGERPRINT)
    .update('\0')
    .update(d.obligationKey)
    .update('\0')
    .update(`${d.artifactRef.type}:${d.artifactRef.identity}`)
    .update('\0')
    .update(JSON.stringify(d.specSide ?? null))
    .update('\0')
    .update(JSON.stringify(d.codeSide ?? null))
    .update('\0')
    .update(d.message)
    .digest('hex');
}

const EnrichedDriftSchema = z.object({
  specReadable: z.string().min(1),
  codeReadable: z.string().min(1),
  summary: z.string().min(1),
});

// ---------------------------------------------------------------------------
// User prompt
// ---------------------------------------------------------------------------

function buildUserPrompt(d: DriftLike): string {
  const parts: string[] = [];
  parts.push(`artifact: ${d.artifactRef.type}:${d.artifactRef.identity}`);
  parts.push(`obligation: ${d.obligationKey}`);
  parts.push(`severity: ${d.severity}`);
  parts.push(`message: ${d.message}`);
  if (d.specSide) parts.push(`spec side (structured): ${d.specSide}`);
  if (d.codeSide) parts.push(`code side (structured): ${d.codeSide}`);
  parts.push('');
  parts.push('Return the JSON object as specified.');
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Single-drift enrichment
// ---------------------------------------------------------------------------

/**
 * Enrich ONE drift. Returns the readable prose, or `null` when no LLM transport
 * is configured or the call fails/parses badly (caller falls back to structured).
 * Caches on a content-addressed key, so the second call for the same drift is free.
 */
export async function enrichDrift(d: DriftLike): Promise<EnrichedDrift | null> {
  const transport = getDefaultTransport();
  if (!transport) return null;

  const key = driftContentKey(d);

  try {
    const cached = await getCacheEntry(CACHE_SCOPE, CACHE_NAME, key);
    if (cached !== null) {
      const parsed = EnrichedDriftSchema.safeParse(cached);
      if (parsed.success) return parsed.data;
      // Malformed entry — fall through and recompute.
    }
  } catch {
    // Cache read failure is non-fatal; recompute below.
  }

  let raw: string;
  try {
    raw = await transport({
      id: `gate.driftEnrich:${key.slice(0, 16)}`,
      stage: 'gate.driftEnrich',
      system: DRIFT_ENRICHMENT_SYSTEM_PROMPT,
      user: buildUserPrompt(d),
      responseFormat: 'json',
      timeoutMs: 30_000,
    });
  } catch {
    return null; // transport error / timeout → graceful structured fallback.
  }

  let value: EnrichedDrift;
  try {
    const inner = JSON.parse(stripCodeFences(raw));
    value = EnrichedDriftSchema.parse(inner);
  } catch {
    return null; // parse / validation failure → graceful fallback.
  }

  try {
    await setCacheEntry(CACHE_SCOPE, CACHE_NAME, key, value);
  } catch {
    // Cache write failure is non-fatal — still return the fresh value.
  }
  return value;
}

// ---------------------------------------------------------------------------
// Batch enrichment (the gate enriches decision.added)
// ---------------------------------------------------------------------------

const DEFAULT_CONCURRENCY = 3;

/**
 * Enrich a BATCH of drifts with small concurrency, tolerating individual
 * failures. Returns a Map keyed by `driftContentKey(d)`; a drift that fails (or
 * has no transport) is simply absent, so the caller falls back per-drift. When
 * no transport is configured at all, returns an empty Map without any LLM work.
 */
export async function enrichDrifts(
  drifts: DriftLike[],
  opts: { concurrency?: number } = {},
): Promise<Map<string, EnrichedDrift>> {
  const out = new Map<string, EnrichedDrift>();
  if (drifts.length === 0) return out;
  if (!getDefaultTransport()) return out;

  const concurrency = Math.max(1, opts.concurrency ?? DEFAULT_CONCURRENCY);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = cursor++;
      if (i >= drifts.length) return;
      const d = drifts[i];
      try {
        const enriched = await enrichDrift(d);
        if (enriched) out.set(driftContentKey(d), enriched);
      } catch {
        // Per-drift failure is swallowed — caller falls back to structured.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, drifts.length) }, () => worker()),
  );
  return out;
}

/** Exposed for tests / cache-rotation assertions. */
export const __DRIFT_ENRICHMENT_PROMPT_FINGERPRINT = PROMPT_FINGERPRINT;
