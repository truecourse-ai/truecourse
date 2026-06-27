/**
 * LLM-driven per-conflict resolver.
 *
 * Runs over every OPEN conflict after the merge + explain stages. For
 * each conflict an Opus call inspects the candidates and answers:
 *
 *   { "pick": <N>, "confidence": "high"|"medium"|"low", "reasoning": "..." }
 *
 * Only `high`-confidence resolutions get auto-applied (synthesized as a
 * decision the orchestrator stitches into `decidedConflicts`). Medium /
 * low confidence leaves the conflict open with the reasoning attached
 * so the user sees the model's thinking next to the explanation.
 *
 * Cached per-conflict by (conflictId, candidateFingerprint,
 * promptFingerprint) — re-runs with unchanged candidates skip the LLM.
 *
 * User picks ALWAYS win: any conflict that already has a decision in
 * `decisions.json` never enters the resolver. The auto-resolution is
 * not persisted to disk — every scan regenerates it from cache.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import type { Conflict } from './types.js';
import { defaultConcurrency } from './runner.js';

const CACHE_NAME = 'consolidator/conflict-resolutions';

export interface ConflictResolverInput {
  conflict: Conflict;
}

export interface ConflictResolution {
  pick: number;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
}

export type ConflictResolverRunner = (
  input: ConflictResolverInput,
) => Promise<ConflictResolution>;

export interface ConflictResolverOptions {
  /** Override the runner. Tests pass a stub. */
  runner?: ConflictResolverRunner;
  /**
   * LLM transport forwarded to the default spawn runner. Defaults to
   * `cliTransport()` (spawns `claude -p`).
   */
  transport?: LlmTransport;
  /** When false, skip the LLM call entirely. */
  enabled?: boolean;
  /** Cap on concurrent LLM calls (default: 2 — these are Opus, slower). */
  concurrency?: number;
  /** Model forwarded to the default spawn runner. */
  model?: string;
  /** Fallback model forwarded to the default spawn runner. */
  fallbackModel?: string;
  /** Fires once before any resolver work begins. */
  onStart?: (total: number) => void;
  /** Fires once per conflict after its resolution completes (success or fallback). */
  onDone?: (resolution: ConflictResolution) => void;
}

export interface ResolvedConflict {
  conflict: Conflict;
  resolution: ConflictResolution;
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

/**
 * Run the resolver over `conflicts` (the merger's open conflicts).
 * Returns one resolution per conflict — caller decides what to do with
 * each (auto-apply high-confidence, leave the rest open with the
 * reasoning attached).
 *
 * Failures degrade gracefully: a conflict that errors out gets a
 * `low`-confidence sentinel resolution so it stays open with a clear
 * reason — better than silently dropping into auto-apply.
 */
export async function resolveConflicts(
  repoRoot: string,
  conflicts: Conflict[],
  opts: ConflictResolverOptions = {},
): Promise<ResolvedConflict[]> {
  if (opts.enabled === false || conflicts.length === 0) return [];
  const runner =
    opts.runner ??
    spawnConflictResolverRunner({
      transport: opts.transport,
      model: opts.model,
      fallbackModel: opts.fallbackModel,
    });
  const concurrency = opts.concurrency ?? defaultConcurrency();
  opts.onStart?.(conflicts.length);
  const tBatchStart = perfNow();
  debugLog(`resolve:batch start total=${conflicts.length} concurrency=${concurrency}`);

  const out: ResolvedConflict[] = [];
  let cursor = 0;
  let active = 0;
  await new Promise<void>((resolve) => {
    const launch = (): void => {
      while (active < concurrency && cursor < conflicts.length) {
        const conflict = conflicts[cursor++];
        active++;
        resolveOne(repoRoot, conflict, runner)
          .then((resolution) => {
            out.push({ conflict, resolution });
            opts.onDone?.(resolution);
          })
          .catch((e) => {
            const resolution: ConflictResolution = {
              pick: conflict.defaultPick,
              confidence: 'low',
              reasoning: `resolver failed: ${e instanceof Error ? e.message : String(e)}`,
            };
            out.push({ conflict, resolution });
            opts.onDone?.(resolution);
          })
          .finally(() => {
            active--;
            if (cursor >= conflicts.length && active === 0) resolve();
            else launch();
          });
      }
      if (cursor >= conflicts.length && active === 0) resolve();
    };
    launch();
  });
  debugLog(`resolve:batch done totalMs=${(perfNow() - tBatchStart).toFixed(0)}`);
  return out;
}

async function resolveOne(
  repoRoot: string,
  conflict: Conflict,
  runner: ConflictResolverRunner,
): Promise<ConflictResolution> {
  const cacheKey = computeCacheKey(conflict);
  const t0 = perfNow();
  const cached = await readCache(repoRoot, cacheKey);
  const tCacheRead = perfNow() - t0;
  if (cached) {
    debugLog(`resolve:${shortId(conflict.id)} cache-hit readMs=${tCacheRead.toFixed(0)}`);
    return cached;
  }
  const tRunStart = perfNow();
  const resolution = await runner({ conflict });
  const tRunMs = perfNow() - tRunStart;
  const isInvalid =
    !Number.isInteger(resolution.pick) ||
    resolution.pick < 0 ||
    resolution.pick >= conflict.candidates.length;
  const final = isInvalid
    ? ({
        pick: conflict.defaultPick,
        confidence: 'low',
        reasoning: `resolver returned out-of-range pick (${resolution.pick}); defaulting to engine pick (${conflict.defaultPick}).`,
      } as ConflictResolution)
    : resolution;
  const tWriteStart = perfNow();
  await writeCache(repoRoot, cacheKey, final);
  const tWriteMs = perfNow() - tWriteStart;
  debugLog(
    `resolve:${shortId(conflict.id)} miss runnerMs=${tRunMs.toFixed(0)} cacheReadMs=${tCacheRead.toFixed(0)} cacheWriteMs=${tWriteMs.toFixed(0)} totalMs=${(perfNow() - t0).toFixed(0)}`,
  );
  return final;
}

// ---------------------------------------------------------------------------
// Debug timing — gated behind TRUECOURSE_DEBUG_TIMING=1 so normal runs stay
// quiet. Writes to stderr so it doesn't collide with --json stdout payloads.
// ---------------------------------------------------------------------------

function perfNow(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function debugLog(msg: string): void {
  if (process.env.TRUECOURSE_DEBUG_TIMING) {
    process.stderr.write(`[tc-timing] ${msg}\n`);
  }
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Prompt + subprocess runner
// ---------------------------------------------------------------------------

export const CONFLICT_RESOLVER_SYSTEM_PROMPT = `You resolve a documentation conflict by picking which candidate should win.

INPUT: one conflict and N candidates (typically 2–4). Each candidate carries:
  - source file path + base name
  - doc kind (PRD, ADR, README, runbook, design-note, schema-discovery, unknown)
  - last touched timestamp
  - lifecycle status (shipped / deferred / out-of-scope / deprecated / null)
  - structured content (JSON)
  - the conflict's plain-English "what differs" explanation (when available)

OUTPUT: ONE JSON object, no prose, no fences:

  { "pick": <integer 0..N-1>, "confidence": "high"|"medium"|"low", "reasoning": "1–3 sentence rationale" }

Rules for the PICK:

  1. PREFER docs that describe what is actually SHIPPED in production over
     docs that describe what was PLANNED. A schema-discovery, runbook,
     migration log, or deployment doc with concrete fields/params usually
     beats a v1 PRD that lists the surface without details.
  2. PREFER explicit / specific contracts over hand-wavy ones. A candidate
     that names exact query params, headers, response shapes, error codes
     wins over one that only mentions the endpoint exists.
  3. Document-kind authority is a TIE-BREAKER, not a primary signal.
     ADR/RFC > PRD/spec > runbook/design-note > README — but only when
     the content quality is roughly equivalent. A runbook with the real
     contract beats a PRD that's a stub.
  4. status=shipped beats status=null/deferred when the underlying content
     is comparable.
  5. When the conflict is two valid candidates describing DIFFERENT aspects
     of the same subject (e.g. overview describing scope vs guide describing
     algorithm), the right answer is usually "neither pick wins cleanly" —
     in that case set confidence: "low" and explain the trade-off so a human
     decides.

Rules for CONFIDENCE:

  - "high": one candidate clearly wins on the rules above; picking it
    drops only obsolete or stub content. The auto-apply threshold.
  - "medium": one candidate likely wins but the loser still has signal
    the user might want; surface to human.
  - "low": the conflict is a true trade-off (architectural choice,
    information loss on either side, or candidates incomparable);
    explain WHY a human needs to decide.

Rules for REASONING:

  - 1–3 sentences. Concrete. Name files by base name (e.g. "schema_discovery.md", "v1 PRD").
  - Cite the specific signal you used ("DEPLOYMENT.md documents the
    actual start_date/end_date params"; "v1 PRD is a template missing
    the audit fields").
  - When confidence is medium/low, name what's at stake.`;

function buildResolverUserPrompt(conflict: Conflict): string {
  const parts: string[] = [];
  parts.push(`Conflict subject: ${conflict.subject}`);
  parts.push(`Conflict topic: ${conflict.topic}`);
  parts.push(`Candidates: ${conflict.candidates.length} (indices 0..${conflict.candidates.length - 1})`);
  parts.push(`Engine's default pick: ${conflict.defaultPick}`);
  if (conflict.explanation) {
    parts.push('');
    parts.push('Plain-English explanation of how candidates differ:');
    parts.push(conflict.explanation);
  }
  parts.push('');
  for (let i = 0; i < conflict.candidates.length; i++) {
    const c = conflict.candidates[i];
    const claim = c.claim;
    const basename = claim.provenance.file.split('/').pop() ?? claim.provenance.file;
    parts.push(`--- candidate ${i} (${c.weight}) ---`);
    parts.push(`source: ${claim.provenance.file} (${basename})`);
    parts.push(`docKind: ${claim.metadata.docKind}`);
    parts.push(`lastTouched: ${claim.metadata.lastTouched}`);
    parts.push(`status: ${claim.metadata.status ?? 'null'}`);
    if (claim.kind) parts.push(`kind: ${claim.kind}`);
    parts.push(`content: ${truncateJson(claim.content)}`);
    parts.push('');
  }
  parts.push('Return the JSON object as specified.');
  return parts.join('\n');
}

function truncateJson(value: unknown, max = 1500): string {
  const s = JSON.stringify(value);
  if (s === undefined) return '(none)';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

const ConflictResolutionSchema = z.object({
  pick: z.number().int(),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z.string().default(''),
});

function spawnConflictResolverRunner(
  opts: { transport?: LlmTransport; bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): ConflictResolverRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 240_000;
  return async (input: ConflictResolverInput): Promise<ConflictResolution> => {
    const raw = await transport({
      id: `spec.conflictResolve:${input.conflict.id}`,
      stage: 'spec.conflictResolve',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: CONFLICT_RESOLVER_SYSTEM_PROMPT,
      user: buildResolverUserPrompt(input.conflict),
      responseFormat: 'json',
      timeoutMs,
    });
    const inner = JSON.parse(stripCodeFences(raw));
    return ConflictResolutionSchema.parse(inner);
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CachedResolutionSchema = z.object({
  pick: z.number().int(),
  confidence: z.enum(['high', 'medium', 'low']),
  reasoning: z.string(),
});

const PROMPT_FINGERPRINT = createHash('sha256')
  .update(CONFLICT_RESOLVER_SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 16);

function computeCacheKey(conflict: Conflict): string {
  const ids = conflict.candidates.map((c) => c.claim.id).sort().join(',');
  return createHash('sha256')
    .update(`${PROMPT_FINGERPRINT}::${conflict.id}::${ids}`)
    .digest('hex');
}

// Cached via the pluggable KV seam (Postgres in EE, file in OSS); the content-
// addressed key makes the stored value just the resolution.
async function readCache(scope: string, cacheKey: string): Promise<ConflictResolution | null> {
  const raw = await getCacheEntry(scope, CACHE_NAME, cacheKey);
  if (raw === null) return null;
  const parsed = CachedResolutionSchema.safeParse(raw);
  return parsed.success ? (parsed.data as ConflictResolution) : null;
}

async function writeCache(scope: string, cacheKey: string, resolution: ConflictResolution): Promise<void> {
  await setCacheEntry(scope, CACHE_NAME, cacheKey, resolution);
}
