/**
 * Within-area OVERLAP detection (spec-scan redesign, Phase 1). For each area
 * with two or more docs, it flags doc PAIRS that may DISAGREE — surfaced to the
 * user as readable excerpts so they can resolve with a doc-level relation
 * (replace / precedence / keep-both). Biased to flag-for-human: complementary
 * docs aren't a conflict, but a plausible disagreement is worth a flag.
 *
 * Pairs already covered by a relation (any type, scoped to the area or global)
 * are skipped — they're resolved. The pass is Haiku-tier and cached per pair by
 * (area, both content hashes, prompt fingerprint). It is bounded by
 * `maxPairsPerArea`; when an area exceeds it the extra pairs are reported via
 * `onCapped` rather than silently dropped.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import type { DocCandidate } from './discovery.js';
import type { Area, Overlap } from './corpus-types.js';
import type { Relation } from './types.js';
import { defaultConcurrency } from './runner.js';

export interface OverlapRunnerInput {
  areaId: string;
  a: DocCandidate;
  b: DocCandidate;
}

export interface OverlapVerdict {
  /** True when the two docs may disagree on a specific decision. */
  overlap: boolean;
  /** Short note on what may disagree — shown to the user. */
  note: string;
}

export type OverlapRunner = (input: OverlapRunnerInput) => Promise<OverlapVerdict>;

export interface OverlapDetectorOptions {
  /** Override the runner. Tests pass a stub. */
  runner?: OverlapRunner;
  /** LLM transport for the auto-created runner (defaults to cli). */
  transport?: LlmTransport;
  /** When false, skip the LLM call entirely; no overlaps flagged. */
  enabled?: boolean;
  /** Relations whose pairs are already resolved and should be skipped. */
  relations?: Relation[];
  /** Cap on doc pairs examined per area. Default 60. */
  maxPairsPerArea?: number;
  /** Cap on concurrent LLM calls. Default {@link defaultConcurrency}. */
  concurrency?: number;
  /** Model forwarded to the default spawn runner. */
  model?: string;
  /** Fallback model forwarded to the default spawn runner. */
  fallbackModel?: string;
  /** Fired once per pair examined, plus an initial `(0, total)`. */
  onProgress?: (done: number, total: number) => void;
  /** Fired when an area's pair count exceeds the cap (areaId, examined, total). */
  onCapped?: (areaId: string, examined: number, total: number) => void;
}

const DEFAULT_MAX_PAIRS_PER_AREA = 60;

/**
 * Flag within-area overlaps. Returns a map keyed by area id → the overlaps
 * found in that area (empty/absent areas omitted).
 */
export async function flagOverlaps(
  repoRoot: string,
  areas: Area[],
  docs: DocCandidate[],
  opts: OverlapDetectorOptions = {},
): Promise<Map<string, Overlap[]>> {
  const result = new Map<string, Overlap[]>();
  if (opts.enabled === false) return result;

  const byPath = new Map(docs.map((d) => [d.path, d]));
  const resolved = resolvedPairKeys(opts.relations ?? []);
  const maxPairs = opts.maxPairsPerArea ?? DEFAULT_MAX_PAIRS_PER_AREA;

  // Build the work list: every unresolved doc pair in every multi-doc area.
  interface Pair { areaId: string; a: DocCandidate; b: DocCandidate }
  const pairs: Pair[] = [];
  for (const area of areas) {
    const refs = area.docRefs;
    if (refs.length < 2) continue;
    const areaPairs: Pair[] = [];
    for (let i = 0; i < refs.length; i++) {
      for (let j = i + 1; j < refs.length; j++) {
        const a = byPath.get(refs[i]);
        const b = byPath.get(refs[j]);
        if (!a || !b) continue;
        if (isResolved(resolved, area.id, refs[i], refs[j])) continue;
        areaPairs.push({ areaId: area.id, a, b });
      }
    }
    if (areaPairs.length > maxPairs) {
      opts.onCapped?.(area.id, maxPairs, areaPairs.length);
      pairs.push(...areaPairs.slice(0, maxPairs));
    } else {
      pairs.push(...areaPairs);
    }
  }

  const total = pairs.length;
  let done = 0;
  const markDone = (): void => opts.onProgress?.(++done, total);
  opts.onProgress?.(0, total);
  if (total === 0) return result;

  const runner =
    opts.runner ??
    spawnOverlapRunner({ transport: opts.transport, model: opts.model, fallbackModel: opts.fallbackModel });
  // Clamp to >=1: a 0/negative value would stall the hand-rolled limiter.
  const concurrency = Math.max(1, opts.concurrency ?? defaultConcurrency());

  let cursor = 0;
  let active = 0;
  await new Promise<void>((resolve) => {
    const launch = (): void => {
      while (active < concurrency && cursor < pairs.length) {
        const pair = pairs[cursor++];
        active++;
        examineOne(repoRoot, pair.areaId, pair.a, pair.b, runner)
          .then((verdict) => {
            if (verdict.overlap) {
              const list = result.get(pair.areaId) ?? [];
              list.push({ docs: [pair.a.path, pair.b.path], note: verdict.note });
              result.set(pair.areaId, list);
            }
          })
          .catch(() => {
            // A failed pair flags nothing — better than a spurious flag.
          })
          .finally(() => {
            markDone();
            active--;
            if (cursor >= pairs.length && active === 0) resolve();
            else launch();
          });
      }
      if (cursor >= pairs.length && active === 0) resolve();
    };
    launch();
  });

  // Stable ordering for deterministic corpus output.
  for (const [areaId, list] of result) {
    list.sort((x, y) => (x.docs.join() < y.docs.join() ? -1 : 1));
    result.set(areaId, list);
  }
  return result;
}

async function examineOne(
  repoRoot: string,
  areaId: string,
  a: DocCandidate,
  b: DocCandidate,
  runner: OverlapRunner,
): Promise<OverlapVerdict> {
  const cacheKey = computeCacheKey(areaId, a, b);
  const cached = await readCache(repoRoot, cacheKey);
  if (cached) return cached;
  const verdict = await runner({ areaId, a, b });
  await writeCache(repoRoot, cacheKey, verdict);
  return verdict;
}

// ---------------------------------------------------------------------------
// Resolved-pair lookup
// ---------------------------------------------------------------------------

/**
 * Build the set of pair keys that a relation already resolves. A global
 * relation (no scope) resolves the pair in every area; a scoped relation only
 * in its area. We index both a scoped key and a global key so the lookup is one
 * `has()` per candidate pair.
 */
function resolvedPairKeys(relations: Relation[]): Set<string> {
  const set = new Set<string>();
  for (const r of relations) {
    if (r.scope) set.add(scopedKey(r.scope, r.older, r.newer));
    else set.add(globalKey(r.older, r.newer));
  }
  return set;
}

const sortedPair = (x: string, y: string): string => [x, y].sort().join(' ');
const globalKey = (x: string, y: string): string => `* ${sortedPair(x, y)}`;
const scopedKey = (scope: string, x: string, y: string): string => `${scope} ${sortedPair(x, y)}`;

/** A pair is resolved if a global OR area-scoped relation covers it. */
function isResolved(set: Set<string>, areaId: string, x: string, y: string): boolean {
  return set.has(globalKey(x, y)) || set.has(scopedKey(areaId, x, y));
}

// ---------------------------------------------------------------------------
// Prompt + subprocess runner
// ---------------------------------------------------------------------------

export const OVERLAP_DETECTOR_SYSTEM_PROMPT = `You compare TWO documentation files that both cover the same AREA of a software system and decide whether they may DISAGREE.

DISAGREE = the two docs state different things about the SAME specific decision: a different value, field name, type, default, rule, enum member, status code, endpoint shape, or named behavior. That is something a human must reconcile.

NOT a disagreement (do NOT flag):
  - Complementary coverage — each doc specs different parts of the area (different fields, different endpoints) with no contradiction.
  - One doc is a high-level summary and the other adds detail, consistently.
  - Identical or trivially compatible statements.

Bias: when there is a PLAUSIBLE contradiction a human should check, flag it. When the docs are clearly complementary or agree, do not.

Output ONLY a JSON object, no prose, no code fences:

{ "overlap": true, "note": "doc A says auth0_id, doc B says auth0_sub for the same user column" }

Use { "overlap": false, "note": "" } when they are complementary or agree. The note is shown to the user — name the specific thing that differs.`;

/** How many lines of each doc to show the comparator. */
const OVERLAP_PREVIEW_LINES = 120;

function docBody(doc: DocCandidate): string {
  if (doc.content !== undefined) return doc.content;
  if (doc.absPath) {
    try {
      return fs.readFileSync(doc.absPath, 'utf-8');
    } catch {
      /* fall through to preview */
    }
  }
  return doc.preview;
}

export function buildOverlapUserPrompt(areaId: string, a: DocCandidate, b: DocCandidate): string {
  const slice = (d: DocCandidate): string => docBody(d).split(/\r?\n/).slice(0, OVERLAP_PREVIEW_LINES).join('\n');
  return [
    `Area: ${areaId}`,
    '',
    `--- doc A: ${a.path} ---`,
    slice(a),
    `--- end doc A ---`,
    '',
    `--- doc B: ${b.path} ---`,
    slice(b),
    `--- end doc B ---`,
    '',
    'Return the JSON object as specified.',
  ].join('\n');
}

const OverlapVerdictSchema = z.object({
  overlap: z.boolean(),
  note: z.string().default(''),
});

function spawnOverlapRunner(
  opts: { transport?: LlmTransport; bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): OverlapRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 90_000;
  return async ({ areaId, a, b }) => {
    const raw = await transport({
      id: `spec.overlap:${areaId}:${a.path}:${b.path}`,
      stage: 'spec.overlap',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: OVERLAP_DETECTOR_SYSTEM_PROMPT,
      user: buildOverlapUserPrompt(areaId, a, b),
      responseFormat: 'json',
      timeoutMs,
    });
    const inner = JSON.parse(stripCodeFences(raw));
    return OverlapVerdictSchema.parse(inner);
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

const CACHE_NAME = 'consolidator/overlap';

const PROMPT_FINGERPRINT = createHash('sha256').update(OVERLAP_DETECTOR_SYSTEM_PROMPT).digest('hex').slice(0, 16);

function computeCacheKey(areaId: string, a: DocCandidate, b: DocCandidate): string {
  // Order-insensitive on the two docs so (a,b) and (b,a) share a cache entry.
  const hashes = [a.contentHash, b.contentHash].sort().join('::');
  return createHash('sha256').update(`${PROMPT_FINGERPRINT}::${areaId}::${hashes}`).digest('hex');
}

async function readCache(scope: string, cacheKey: string): Promise<OverlapVerdict | null> {
  const raw = await getCacheEntry(scope, CACHE_NAME, cacheKey);
  if (raw === null) return null;
  const parsed = OverlapVerdictSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function writeCache(scope: string, cacheKey: string, verdict: OverlapVerdict): Promise<void> {
  await setCacheEntry(scope, CACHE_NAME, cacheKey, verdict);
}
