/**
 * Gap auto-close judge.
 *
 * A "gap" is a target the enumerator listed but the extractor never produced a
 * contract for. Many gaps are NOT real misses: the enumerator over-listed (the
 * area's docs don't actually specify the target), or the artifact WAS written in
 * another area under a different identity. This pass — one cheap LLM call per
 * area-with-gaps, run AFTER generate+assemble when the full written corpus is
 * known — judges each gap and CLOSES the justified ones, keeping only genuine
 * misses (annotated with a reason). Mirrors `target-reconciler` (cached,
 * normalized, best-effort: a failure keeps all gaps rather than dropping a real one).
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import { coverageKey } from './corpus-prompt.js';
import type { AreaGenInput } from './corpus-reader.js';
// Type-only (erased at runtime → no cycle with corpus-generate, which imports this).
import type { CoverageGap } from './corpus-generate.js';

export interface GapJudgeInput {
  areaId: string;
  product: string;
  concern: string;
  docs: { ref: string; content: string }[];
  gaps: { kind: string; identity: string; hint?: string }[];
  /** Kind+identity of every contract actually written (across all areas). */
  corpus: { kind: string; identity: string }[];
}

export interface GapVerdict {
  justified: boolean;
  reason: string;
  /** When justified because it's already written elsewhere, the artifact that covers it. */
  coveredBy?: { kind: string; identity: string };
}

export type GapJudgeResult = { verdicts: Record<string, GapVerdict> };

export type GapJudgeRunner = (input: GapJudgeInput) => Promise<GapJudgeResult>;

export interface GapJudgeOptions {
  runner?: GapJudgeRunner;
  transport?: LlmTransport;
  /** When false, skip the LLM judge entirely (all gaps kept). */
  enabled?: boolean;
  model?: string;
  fallbackModel?: string;
}

/**
 * Judge one area's gaps against its docs + the full written corpus. Returns the
 * gaps to KEEP (justified ones dropped; survivors annotated with the reason).
 */
export async function judgeGaps(
  scope: string,
  area: AreaGenInput,
  gaps: CoverageGap[],
  corpus: { kind: string; identity: string }[],
  opts: GapJudgeOptions = {},
): Promise<CoverageGap[]> {
  if (gaps.length === 0 || opts.enabled === false) return gaps;

  const input: GapJudgeInput = {
    areaId: area.areaId,
    product: area.product,
    concern: area.concern,
    docs: area.docs.map((d) => ({ ref: d.ref, content: d.content })),
    gaps: gaps.map((g) => ({ kind: g.kind, identity: g.identity, hint: g.hint })),
    corpus,
  };

  const key = computeCacheKey(input);
  let verdicts = await readCache(scope, key);
  if (!verdicts) {
    const runner = opts.runner ?? spawnGapJudgeRunner({ transport: opts.transport, model: opts.model, fallbackModel: opts.fallbackModel });
    try {
      verdicts = normalizeVerdicts((await runner(input)).verdicts);
      await writeCache(scope, key, verdicts);
    } catch {
      return gaps; // best-effort — never silently drop a real gap on failure
    }
  }

  // Drop justified gaps; annotate the survivors with their reason/coveredBy.
  const kept: CoverageGap[] = [];
  for (const g of gaps) {
    const v = verdicts[coverageKey(g.kind, g.identity)];
    if (v?.justified) continue;
    kept.push(v ? { ...g, justified: false, reason: v.reason, coveredBy: v.coveredBy } : g);
  }
  return kept;
}

/** Re-key the LLM's `<Kind>:<identity>` verdicts by coverage key so lookups match. */
function normalizeVerdicts(raw: Record<string, GapVerdict>): Record<string, GapVerdict> {
  const out: Record<string, GapVerdict> = {};
  for (const [rawKey, v] of Object.entries(raw ?? {})) {
    const colon = rawKey.indexOf(':');
    if (colon === -1 || !v || typeof v.justified !== 'boolean') continue;
    out[coverageKey(rawKey.slice(0, colon), rawKey.slice(colon + 1))] = {
      justified: v.justified,
      reason: typeof v.reason === 'string' ? v.reason : '',
      coveredBy:
        v.coveredBy && typeof v.coveredBy.kind === 'string' && typeof v.coveredBy.identity === 'string'
          ? v.coveredBy
          : undefined,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Prompt + subprocess runner
// ---------------------------------------------------------------------------

export const GAP_JUDGE_SYSTEM_PROMPT = `You audit enumerated contract TARGETS that were NEVER written as contracts for ONE area of a software system. For each gap, decide whether the miss is JUSTIFIED.

justified=true when EITHER:
  (a) the AREA DOCS below do not actually specify that target — the enumerator over-listed it; or
  (b) an equivalent contract already exists in the WRITTEN CORPUS under a different identity — then set "coveredBy" to that existing {kind, identity}.

justified=false when the docs DO specify it and nothing equivalent was written — a genuine miss.

Always give a short "reason". When unsure, prefer justified=false (surface it).

Output ONLY JSON, one entry per gap keyed by "<Kind>:<identity>":
{ "verdicts": {
    "FieldExposure:order.server-assigned-fields": { "justified": true, "reason": "already written as order-response-fields", "coveredBy": { "kind": "FieldExposure", "identity": "order-response-fields" } },
    "ForbiddenArtifact:replace-order-endpoint": { "justified": false, "reason": "docs forbid POST /orders/:id/replace but no contract was written" }
} }`;

export function buildGapJudgeUserPrompt(input: GapJudgeInput): string {
  const docs = input.docs.map((d) => `<!-- ${d.ref} -->\n${d.content}`).join('\n\n');
  const gapList = input.gaps.map((g) => `  - ${g.kind}: ${g.identity}${g.hint ? ` — ${g.hint}` : ''}`).join('\n');
  const corpusList = input.corpus.length
    ? input.corpus.map((c) => `  - ${c.kind}: ${c.identity}`).join('\n')
    : '  (none)';
  return [
    `AREA: ${input.areaId} (product: ${input.product}, concern: ${input.concern})`,
    '',
    'AREA DOCS:',
    docs,
    '',
    'GAPS (enumerated but not written) — judge each:',
    gapList,
    '',
    'WRITTEN CORPUS (every contract written, across all areas — for "covered elsewhere"):',
    corpusList,
    '',
    'Return the verdicts JSON as specified.',
  ].join('\n');
}

const GapJudgeResultSchema = z.object({
  verdicts: z
    .record(
      z.string(),
      z.object({
        justified: z.boolean(),
        reason: z.string().default(''),
        coveredBy: z.object({ kind: z.string(), identity: z.string() }).optional(),
      }),
    )
    .default({}),
});

function spawnGapJudgeRunner(
  opts: { transport?: LlmTransport; bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): GapJudgeRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 300_000;
  return async (input) => {
    const raw = await transport({
      id: `contract.gapJudge:${input.areaId}`,
      stage: 'contract.gapJudge',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: GAP_JUDGE_SYSTEM_PROMPT,
      user: buildGapJudgeUserPrompt(input),
      responseFormat: 'json',
      timeoutMs,
    });
    return GapJudgeResultSchema.parse(JSON.parse(stripCodeFences(raw)));
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_NAME = 'contract/gap-judge';
const PROMPT_FINGERPRINT = createHash('sha256').update(GAP_JUDGE_SYSTEM_PROMPT).digest('hex').slice(0, 16);

function computeCacheKey(input: GapJudgeInput): string {
  const gapKeys = input.gaps.map((g) => coverageKey(g.kind, g.identity)).sort().join(',');
  const corpusKeys = input.corpus.map((c) => coverageKey(c.kind, c.identity)).sort().join(',');
  const docHash = createHash('sha256').update(input.docs.map((d) => `${d.ref}:${d.content}`).join('|')).digest('hex');
  return createHash('sha256')
    .update(`${PROMPT_FINGERPRINT}::${input.areaId}::${gapKeys}::${docHash}::${corpusKeys}`)
    .digest('hex');
}

async function readCache(scope: string, key: string): Promise<Record<string, GapVerdict> | null> {
  const raw = await getCacheEntry(scope, CACHE_NAME, key);
  if (raw === null) return null;
  const parsed = GapJudgeResultSchema.safeParse(raw);
  return parsed.success ? parsed.data.verdicts : null;
}

async function writeCache(scope: string, key: string, verdicts: Record<string, GapVerdict>): Promise<void> {
  await setCacheEntry(scope, CACHE_NAME, key, { verdicts });
}
