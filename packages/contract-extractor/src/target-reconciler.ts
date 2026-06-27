/**
 * Global target reconciliation (spec-scan redesign, Phase 2 — over-generation fix).
 *
 * Each area enumerates its targets independently, so a cross-cutting decision
 * (the outbox pattern, the bearer-auth requirement) gets enumerated in several
 * areas, often under a DIFFERENT identity each time (`outbox-pattern` vs
 * `transactional-outbox`). Generating per-area then produces the same artifact
 * many times, and because the identities differ, `merge` can't collapse them and
 * the completeness gate's retries amplify the duplication.
 *
 * This pass runs AFTER enumeration and BEFORE generate. It:
 *   (a) de-dups targets across areas deterministically by coverage key (same
 *       identity in N areas → generated once, in the first area), and
 *   (b) reconciles SEMANTIC duplicates (different identities, same artifact) via
 *       one LLM clustering call that assigns a canonical (kind, identity) per
 *       cluster — so each real artifact is generated exactly once.
 *
 * Net effect: each artifact is generated once with a stable identity → no
 * cross-area bloat, merge dedups cleanly, fewer generate calls. Mirrors the
 * `vocab-normalizer` pattern (cached, sanitized, best-effort). No hardcoding.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import { coverageKey, type TargetSpec } from './corpus-prompt.js';
import type { AreaGenInput } from './corpus-reader.js';

/** Per-area enumerated targets — the input and output shape of reconciliation. */
export interface AreaTargets {
  area: AreaGenInput;
  targets: TargetSpec[];
}

export interface ReconcileRunnerInput {
  /** Distinct targets across all areas (deduped by coverage key). */
  targets: { kind: string; identity: string; hint?: string }[];
}
/** Returns merges: each non-canonical `coverageKey` → its canonical kind+identity. */
export type ReconcileRunner = (input: ReconcileRunnerInput) => Promise<{
  merges: Record<string, { kind: string; identity: string }>;
}>;

export interface TargetReconcilerOptions {
  runner?: ReconcileRunner;
  transport?: LlmTransport;
  /** When false, only the deterministic cross-area de-dup runs (no LLM). */
  enabled?: boolean;
  model?: string;
  fallbackModel?: string;
}

/**
 * Reconcile the enumerated targets globally. Returns per-area target lists where
 * each unique artifact appears exactly once (assigned to the first area that
 * enumerated it), with canonical identities.
 */
export async function reconcileTargets(
  scope: string,
  byArea: AreaTargets[],
  opts: TargetReconcilerOptions = {},
): Promise<AreaTargets[]> {
  // Flatten, remembering the first area each coverage key came from.
  const firstArea = new Map<string, string>(); // coverageKey → areaId
  const distinct = new Map<string, TargetSpec>(); // coverageKey → target (first seen)
  for (const { area, targets } of byArea) {
    for (const t of targets) {
      const k = coverageKey(t.kind, t.identity);
      if (!distinct.has(k)) {
        distinct.set(k, t);
        firstArea.set(k, area.areaId);
      }
    }
  }

  // (b) Semantic reconciliation — map duplicate identities onto a canonical one.
  let merges: Record<string, { kind: string; identity: string }> = {};
  if (opts.enabled !== false && distinct.size >= 2) {
    const input: ReconcileRunnerInput = {
      targets: [...distinct.values()].map((t) => ({ kind: t.kind, identity: t.identity, hint: t.hint })),
    };
    const key = computeCacheKey(input);
    const cached = await readCache(scope, key);
    if (cached) {
      merges = cached;
    } else {
      const runner = opts.runner ?? spawnReconcileRunner({ transport: opts.transport, model: opts.model, fallbackModel: opts.fallbackModel });
      try {
        merges = sanitize((await runner(input)).merges, distinct);
        await writeCache(scope, key, merges);
      } catch {
        merges = {}; // best-effort — fall back to deterministic-only de-dup
      }
    }
  }

  // Apply merges: rewrite each distinct target to its canonical identity, then
  // collapse again by the NEW coverage key (so `outbox-pattern` and
  // `transactional-outbox` both land on one canonical target in one area).
  const canonByArea = new Map<string, Map<string, TargetSpec>>(); // areaId → (coverageKey → target)
  for (const [k, t] of distinct) {
    const canon = merges[k];
    const target: TargetSpec = canon ? { kind: canon.kind, identity: canon.identity, hint: t.hint } : t;
    const ck = coverageKey(target.kind, target.identity);
    const areaId = firstArea.get(canon ? coverageKey(canon.kind, canon.identity) : k) ?? firstArea.get(k)!;
    const m = canonByArea.get(areaId) ?? new Map<string, TargetSpec>();
    if (!m.has(ck)) m.set(ck, target);
    canonByArea.set(areaId, m);
  }

  // Rebuild per-area lists in the original area order.
  return byArea.map(({ area }) => ({ area, targets: [...(canonByArea.get(area.areaId)?.values() ?? [])] }));
}

/** Keep only safe merges: canonical must itself be one of the input targets; drop self-merges. */
function sanitize(
  merges: Record<string, { kind: string; identity: string }> | undefined,
  distinct: Map<string, TargetSpec>,
): Record<string, { kind: string; identity: string }> {
  const out: Record<string, { kind: string; identity: string }> = {};
  for (const [fromRaw, to] of Object.entries(merges ?? {})) {
    if (!to || typeof to.kind !== 'string' || typeof to.identity !== 'string') continue;
    // The LLM emits keys as "<Kind>:<identity>" (PascalCase kind); normalize both
    // sides through coverageKey so they match `distinct` (keyed by coverage key).
    const colon = fromRaw.indexOf(':');
    if (colon === -1) continue;
    const fromKey = coverageKey(fromRaw.slice(0, colon), fromRaw.slice(colon + 1));
    const toKey = coverageKey(to.kind, to.identity);
    if (!distinct.has(fromKey) || !distinct.has(toKey)) continue; // both sides must be real targets
    if (fromKey === toKey) continue; // identity merge
    out[fromKey] = { kind: to.kind, identity: to.identity };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prompt + subprocess runner
// ---------------------------------------------------------------------------

export const RECONCILE_SYSTEM_PROMPT = `You are given the list of contract TARGETS enumerated from ONE repository's docs (kind + identity). Some are DUPLICATES — the SAME artifact named differently because different docs/sections described it. Your job: find duplicate clusters and pick ONE canonical (kind, identity) per cluster.

Duplicates are the same KIND describing the same thing, e.g.:
  - ArchitectureDecision: "outbox-pattern" / "transactional-outbox" / "transactional-outbox-event-delivery" → one decision.
  - AuthRequirement: "bearer-jwt" / "customer-bearer-jwt" / "booking-bearer-jwt" → one requirement.
  - NamedConstant: "max-reschedule-count" / "reschedule-max-count-3" → one constant.

NOT duplicates (never merge):
  - Different kinds.
  - Distinct Operations (different method+path), distinct Entities/Enums by name.
  - Two genuinely different decisions/requirements that merely sound similar.

Cross-cutting kinds (ArchitectureDecision, AuthRequirement, AuthorizationRule, EffectGroup, ErrorEnvelope, NamedConstant, PaginationContract, IdempotencyContract, FieldExposure, Fallback, ValidationRule) duplicate most often across docs — scrutinize those. When unsure, DO NOT merge.

Output ONLY a JSON object mapping each NON-canonical "<kind>:<identity>" to its canonical {kind, identity}. The canonical MUST be one of the input targets. Omit canonical entries (a target that is its own canonical).

{ "merges": {
    "ArchitectureDecision:outbox-pattern": { "kind": "ArchitectureDecision", "identity": "transactional-outbox" },
    "AuthRequirement:customer-bearer-jwt": { "kind": "AuthRequirement", "identity": "bearer-jwt" }
} }

Use an empty "merges" object when nothing is a duplicate.`;

export function buildReconcileUserPrompt(input: ReconcileRunnerInput): string {
  const list = input.targets.map((t) => `  - ${t.kind}: ${t.identity}${t.hint ? ` — ${t.hint}` : ''}`).join('\n');
  return ['Targets enumerated from this repository:', '', list, '', 'Return the merges JSON as specified.'].join('\n');
}

const ReconcileResultSchema = z.object({
  merges: z.record(z.string(), z.object({ kind: z.string(), identity: z.string() })).default({}),
});

function spawnReconcileRunner(
  opts: { transport?: LlmTransport; bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): ReconcileRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  // One clustering call over the whole target list — give it room. Output scales
  // with the target count (one entry per duplicate), so a large corpus (~100
  // targets) needs well past the 300s that sufficed for ~50. A timeout degrades
  // safely to deterministic-only de-dup, but we'd rather get the semantic merge.
  const timeoutMs = opts.timeoutMs ?? 600_000;
  return async (input) => {
    const raw = await transport({
      id: 'contract.reconcile',
      stage: 'contract.reconcile',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: RECONCILE_SYSTEM_PROMPT,
      user: buildReconcileUserPrompt(input),
      responseFormat: 'json',
      timeoutMs,
    });
    return ReconcileResultSchema.parse(JSON.parse(stripCodeFences(raw)));
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_NAME = 'contract/reconcile';
const PROMPT_FINGERPRINT = createHash('sha256').update(RECONCILE_SYSTEM_PROMPT).digest('hex').slice(0, 16);

function computeCacheKey(input: ReconcileRunnerInput): string {
  const material = input.targets.map((t) => coverageKey(t.kind, t.identity)).sort().join(',');
  return createHash('sha256').update(`${PROMPT_FINGERPRINT}::${material}`).digest('hex');
}

async function readCache(scope: string, key: string): Promise<Record<string, { kind: string; identity: string }> | null> {
  const raw = await getCacheEntry(scope, CACHE_NAME, key);
  if (raw === null) return null;
  const parsed = ReconcileResultSchema.safeParse(raw);
  return parsed.success ? parsed.data.merges : null;
}

async function writeCache(scope: string, key: string, merges: Record<string, { kind: string; identity: string }>): Promise<void> {
  await setCacheEntry(scope, CACHE_NAME, key, { merges });
}
