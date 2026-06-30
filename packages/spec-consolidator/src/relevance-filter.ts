/**
 * LLM-driven doc relevance filter.
 *
 * Real projects ship a lot of markdown that isn't spec material:
 * task lists, release-notes drafts, engineering research logs, AI
 * agent instructions, etc. Today every `.md` file is treated as a
 * claim source, so noise from those files competes with PRD claims
 * and produces avoidable conflicts.
 *
 * This module asks an LLM per discovered doc: "is this spec-source
 * material?" When the LLM says no (or low confidence), the doc is
 * marked SKIPPED and excluded from claim extraction. Skipped docs
 * are still surfaced in the scan output so the user can manually
 * re-include them from the dashboard.
 *
 * Cached per-doc by (path, contentHash, promptFingerprint) — re-runs
 * with unchanged docs cost zero tokens. Failures degrade gracefully:
 * a doc that errors out during classification stays INCLUDED (better
 * to keep noise than silently drop a real spec doc).
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import type { DocCandidate } from './discovery.js';
import { defaultConcurrency } from './runner.js';

export interface RelevanceVerdict {
  /** Doc's repo-relative path. */
  path: string;
  /** True when the doc should feed claim extraction. */
  include: boolean;
  /** Short human-readable rationale, shown in the dashboard. */
  reason: string;
}

export interface RelevanceRunnerInput {
  doc: DocCandidate;
}

export type RelevanceRunner = (input: RelevanceRunnerInput) => Promise<RelevanceVerdict>;

export interface RelevanceFilterOptions {
  /** Override the runner. Tests pass a stub. */
  runner?: RelevanceRunner;
  /** LLM transport for the auto-created runner (defaults to cli). */
  transport?: LlmTransport;
  /** When false, skip the LLM call entirely; every doc stays included. */
  enabled?: boolean;
  /**
   * Doc paths the user has manually marked as "always include" via the
   * dashboard. These bypass the filter unconditionally — useful when
   * the LLM is wrong about a doc the user knows is authoritative.
   */
  manualIncludes?: string[];
  /** Cap on concurrent LLM calls. Default 4. */
  concurrency?: number;
  /** Model forwarded to the default spawn runner. */
  model?: string;
  /** Fallback model forwarded to the default spawn runner. */
  fallbackModel?: string;
  /**
   * Fired once per doc as it's classified, plus an initial `(0, total)` so
   * the caller learns the total upfront. Classification is concurrent, so
   * `done` increments in completion order, not doc order.
   */
  onProgress?: (done: number, total: number) => void;
}

export interface RelevanceFilterOutcome {
  /** Docs to feed downstream claim extraction. */
  included: DocCandidate[];
  /** Docs the filter dropped. Surfaced in the dashboard for review. */
  skipped: Array<{ doc: DocCandidate; reason: string }>;
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

/**
 * The deterministic (no-LLM) pre-filter: which docs would be dropped before the
 * LLM classifier runs, and why. Shared by `filterByRelevance` (the real pass)
 * and the scan cost estimator, so both agree on exactly how many docs reach the
 * LLM. Manual includes bypass it unconditionally.
 */
export function prefilterDocs(
  docs: DocCandidate[],
  manualIncludes: string[] = [],
): { toClassify: DocCandidate[]; skipped: Array<{ path: string; reason: string }> } {
  const manualSet = new Set(manualIncludes);
  const reasons = new Map<string, string>();
  for (const doc of docs) {
    if (manualSet.has(doc.path)) continue;
    const reason = deterministicSkip(doc);
    if (reason) reasons.set(doc.path, reason);
  }
  for (const { path, reason } of dedupeNearDuplicates(
    docs.filter((d) => !manualSet.has(d.path) && !reasons.has(d.path)),
  )) {
    reasons.set(path, reason);
  }
  return {
    toClassify: docs.filter((d) => !reasons.has(d.path)),
    skipped: [...reasons].map(([path, reason]) => ({ path, reason })),
  };
}

export async function filterByRelevance(
  repoRoot: string,
  docs: DocCandidate[],
  opts: RelevanceFilterOptions = {},
): Promise<RelevanceFilterOutcome> {
  if (opts.enabled === false || docs.length === 0) {
    return { included: docs, skipped: [] };
  }
  const manualSet = new Set(opts.manualIncludes ?? []);
  const runner =
    opts.runner ??
    spawnRelevanceRunner({ transport: opts.transport, model: opts.model, fallbackModel: opts.fallbackModel });
  const concurrency = opts.concurrency ?? defaultConcurrency();

  // Deterministic pre-filter (no LLM): drop archived/agent-instruction files by
  // path, then near-duplicate copies. Manual includes bypass it unconditionally.
  const { toClassify, skipped: prefilterSkipped } = prefilterDocs(docs, opts.manualIncludes ?? []);
  const prefilterReason = new Map(prefilterSkipped.map((s) => [s.path, s.reason]));

  const total = docs.length;
  let done = 0;
  const markDone = (): void => opts.onProgress?.(++done, total);
  opts.onProgress?.(0, total);
  // Pre-filtered docs need no LLM call — count them toward progress up front.
  for (let i = 0; i < prefilterReason.size; i++) markDone();

  const verdicts = new Map<string, RelevanceVerdict>();
  let cursor = 0;
  let active = 0;
  await new Promise<void>((resolve) => {
    const launch = (): void => {
      while (active < concurrency && cursor < toClassify.length) {
        const doc = toClassify[cursor++];
        if (manualSet.has(doc.path)) {
          verdicts.set(doc.path, { path: doc.path, include: true, reason: 'manual include' });
          markDone();
          if (cursor >= toClassify.length && active === 0) resolve();
          continue;
        }
        active++;
        classifyOne(repoRoot, doc, runner)
          .then((verdict) => {
            verdicts.set(doc.path, verdict);
          })
          .catch(() => {
            // Failures default to include — better to keep noise than drop a real spec doc.
            verdicts.set(doc.path, {
              path: doc.path,
              include: true,
              reason: 'classification failed; defaulting to include',
            });
          })
          .finally(() => {
            markDone();
            active--;
            if (cursor >= toClassify.length && active === 0) resolve();
            else launch();
          });
      }
      if (cursor >= toClassify.length && active === 0) resolve();
    };
    launch();
  });

  const included: DocCandidate[] = [];
  const skipped: Array<{ doc: DocCandidate; reason: string }> = [];
  for (const doc of docs) {
    const pf = prefilterReason.get(doc.path);
    if (pf) {
      skipped.push({ doc, reason: pf });
      continue;
    }
    const verdict = verdicts.get(doc.path);
    if (!verdict || verdict.include) included.push(doc);
    else skipped.push({ doc, reason: verdict.reason });
  }
  return { included, skipped };
}

// ---------------------------------------------------------------------------
// Deterministic pre-filter (no LLM) — high-precision structural signals only
// ---------------------------------------------------------------------------

/** Directory names that mark archived/superseded content. */
const ARCHIVE_SEGMENTS = new Set(['archive', 'archived', 'deprecated', 'old', 'legacy']);
/** Filenames that are agent-instruction / prompt meta, never product spec. */
const SKIP_BASENAMES = new Set([
  'claude.md',
  'agents.md',
  '.cursorrules',
  'copilot-instructions.md',
  'prompt.md',
]);

/** Path/name-based skip reason, or null to defer the call to the LLM. */
function deterministicSkip(doc: DocCandidate): string | null {
  const segs = doc.path.toLowerCase().split('/');
  const base = segs[segs.length - 1];
  // Only DIRECTORY segments trigger the archive rule — a file literally named
  // "old-pricing.md" is fine; "archive/foo.md" is not.
  for (const seg of segs.slice(0, -1)) {
    if (ARCHIVE_SEGMENTS.has(seg)) return `archived/superseded location (under ${seg}/)`;
  }
  if (SKIP_BASENAMES.has(base)) return `agent-instruction/meta file (${base})`;
  return null;
}

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

/** Content lines normalized for similarity (drop blanks + pure-markup lines). */
function normalizedLines(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim().toLowerCase();
    if (l.length === 0) continue;
    if (/^[#>*\-=|`_~ ]+$/.test(l)) continue; // markdown rules / bullet-only lines
    out.add(l);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (big.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

const NEAR_DUP_THRESHOLD = 0.85;
/** Below this many distinct content lines a doc is too thin to judge as a dup. */
const MIN_DEDUP_LINES = 8;

/**
 * Drop near-duplicate docs (e.g. a "condensed" copy of a fuller doc). For each
 * pair with normalized-line Jaccard >= threshold, keep the longer and drop the
 * shorter. O(n^2) — fine for the hundreds of docs a repo has. Docs with too few
 * content lines are never deduped (thin/stub content can collide spuriously).
 */
function dedupeNearDuplicates(docs: DocCandidate[]): Array<{ path: string; reason: string }> {
  const sigs = docs.map((d) => {
    const body = docBody(d);
    return { doc: d, lines: normalizedLines(body), len: body.length };
  });
  const droppedSet = new Set<string>();
  const dropped: Array<{ path: string; reason: string }> = [];
  for (let i = 0; i < sigs.length; i++) {
    if (droppedSet.has(sigs[i].doc.path)) continue;
    if (sigs[i].lines.size < MIN_DEDUP_LINES) continue;
    for (let j = i + 1; j < sigs.length; j++) {
      if (droppedSet.has(sigs[j].doc.path)) continue;
      if (sigs[j].lines.size < MIN_DEDUP_LINES) continue;
      if (jaccard(sigs[i].lines, sigs[j].lines) < NEAR_DUP_THRESHOLD) continue;
      const [keep, drop] = sigs[i].len >= sigs[j].len ? [sigs[i], sigs[j]] : [sigs[j], sigs[i]];
      droppedSet.add(drop.doc.path);
      dropped.push({
        path: drop.doc.path,
        reason: `near-duplicate of ${keep.doc.path} (kept the fuller copy)`,
      });
      if (drop.doc.path === sigs[i].doc.path) break; // i itself dropped → next i
    }
  }
  return dropped;
}

async function classifyOne(
  repoRoot: string,
  doc: DocCandidate,
  runner: RelevanceRunner,
): Promise<RelevanceVerdict> {
  const cacheKey = computeCacheKey(doc);
  const cached = await readCache(repoRoot, cacheKey);
  if (cached) return cached;
  const verdict = await runner({ doc });
  await writeCache(repoRoot, cacheKey, verdict);
  return verdict;
}

// ---------------------------------------------------------------------------
// Subprocess runner
// ---------------------------------------------------------------------------

export const RELEVANCE_SYSTEM_PROMPT = `You are a documentation relevance classifier. Classify by CONTENT, not by folder or filename: does this doc state durable, intended behavior or decisions about THE SYSTEM IN THIS REPOSITORY (its endpoints, data, auth, events, invariants, business rules, architecture)?

INCLUDE (spec-source material):
  - PRDs, ADRs, RFCs, design proposals, spec / API docs, module-level design docs, pipeline/workflow guides
  - Any doc that states our system's contracts, behavior, or decisions — in ANY folder, including tasks/ or backlog/
  - A PRD or decision record IS spec even under a tasks/ folder (a completed one describes implemented behavior; a draft one describes planned behavior)
  - A README only if it describes what the system does / how it behaves

SKIP (not spec-source material):
  - Pure status / TODO checklists, kanban boards, release notes / changelog drafts
  - Docs about a THIRD-PARTY / external system (vendor API research, integration notes) — that is someone else's contract, not ours, and cannot be verified against this codebase
  - SUPERSEDED docs — an older version of a newer doc covering the same subject
  - Process / meta docs not about product behavior: contribution / onboarding guides, code-style guides, deployment runbooks (keep a deployment doc ONLY if it states our runtime contracts)
  - Exploratory scratch with no committed decisions (brain dumps, open-questions-only notes)
  - AI-agent instructions / prompt templates; personal engineering journals

Distinguish "states a decision about our system" (INCLUDE) from "tracks status / describes an external system / is superseded / is process" (SKIP). The SKIP categories above are explicit — they are not "doubt." WHEN GENUINELY AMBIGUOUS: include (dropping a real spec doc costs more than keeping noise).

Output ONLY a JSON object:

  { "include": true|false, "reason": "short explanation" }

The reason is shown to the user in the dashboard — be specific ("vendor API research (ServiceTitan)", "superseded by capacity-ml-plan-v3", "deployment runbook, no product contracts") so they can verify the call.`;

function buildRelevanceUserPrompt(doc: DocCandidate): string {
  // Cap the preview hard — classification doesn't need the full doc.
  const preview = doc.preview.split('\n').slice(0, 60).join('\n');
  return [
    `Path: ${doc.path}`,
    `Detected kind: ${doc.kind}`,
    `Size: ${doc.size} bytes`,
    '',
    '--- preview (first 60 lines) ---',
    preview,
    '--- end preview ---',
    '',
    'Return the JSON object as specified.',
  ].join('\n');
}

const RelevanceVerdictSchema = z.object({
  include: z.boolean(),
  reason: z.string().default(''),
});

function spawnRelevanceRunner(
  opts: {
    /** LLM transport. Defaults to `cliTransport()` (spawns `claude -p`). */
    transport?: LlmTransport;
    bin?: string;
    timeoutMs?: number;
    model?: string;
    fallbackModel?: string;
  } = {},
): RelevanceRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 60_000;
  return async (input: RelevanceRunnerInput): Promise<RelevanceVerdict> => {
    const raw = await transport({
      id: `spec.relevance:${input.doc.path}`,
      stage: 'spec.relevance',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: RELEVANCE_SYSTEM_PROMPT,
      user: buildRelevanceUserPrompt(input.doc),
      responseFormat: 'json',
      timeoutMs,
    });
    const inner = JSON.parse(stripCodeFences(raw));
    const parsed = RelevanceVerdictSchema.parse(inner);
    return { path: input.doc.path, include: parsed.include, reason: parsed.reason };
  };
}

// ---------------------------------------------------------------------------
// Cache — content-addressed, via the pluggable KV seam (`@truecourse/llm`
// get/setCacheEntry): Postgres in EE, file in OSS. The cache KEY already folds
// in the prompt fingerprint + the doc's contentHash, so an unchanged doc is a
// hit and a prompt change invalidates. No direct fs — so an EE workspace scan
// (ephemeral scratch scope) still gets hits across syncs.
// ---------------------------------------------------------------------------

const CACHE_NAME = 'consolidator/relevance';

const PROMPT_FINGERPRINT = createHash('sha256')
  .update(RELEVANCE_SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 16);

function computeCacheKey(doc: DocCandidate): string {
  return createHash('sha256')
    .update(`${PROMPT_FINGERPRINT}::${doc.path}::${doc.contentHash}`)
    .digest('hex');
}

const CachedVerdictSchema = z.object({
  path: z.string(),
  include: z.boolean(),
  reason: z.string(),
});

async function readCache(scope: string, cacheKey: string): Promise<RelevanceVerdict | null> {
  const raw = await getCacheEntry(scope, CACHE_NAME, cacheKey);
  if (raw === null) return null;
  const parsed = CachedVerdictSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function writeCache(scope: string, cacheKey: string, verdict: RelevanceVerdict): Promise<void> {
  await setCacheEntry(scope, CACHE_NAME, cacheKey, verdict);
}

/**
 * The cached relevance verdict for a doc, or null on a cache miss (the doc will
 * need an LLM classify on the next run). Reuses the runtime cache key, so the
 * pre-flight estimate sees exactly what the next scan will hit.
 */
export async function readRelevanceCache(repoRoot: string, doc: DocCandidate): Promise<RelevanceVerdict | null> {
  return readCache(repoRoot, computeCacheKey(doc));
}
