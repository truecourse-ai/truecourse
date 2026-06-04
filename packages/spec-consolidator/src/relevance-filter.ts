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
import path from 'node:path';
import { z } from 'zod';
import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import type { DocCandidate } from './discovery.js';
import { cachePaths, ensureCacheDirs } from './cache.js';

const CACHE_FILE = 'relevance.json';

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
  const concurrency = opts.concurrency ?? 4;

  const total = docs.length;
  let done = 0;
  const markDone = (): void => opts.onProgress?.(++done, total);
  opts.onProgress?.(0, total);

  const verdicts = new Map<string, RelevanceVerdict>();
  let cursor = 0;
  let active = 0;
  await new Promise<void>((resolve) => {
    const launch = (): void => {
      while (active < concurrency && cursor < docs.length) {
        const doc = docs[cursor++];
        if (manualSet.has(doc.path)) {
          verdicts.set(doc.path, { path: doc.path, include: true, reason: 'manual include' });
          markDone();
          if (cursor >= docs.length && active === 0) resolve();
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
            if (cursor >= docs.length && active === 0) resolve();
            else launch();
          });
      }
      if (cursor >= docs.length && active === 0) resolve();
    };
    launch();
  });

  const included: DocCandidate[] = [];
  const skipped: Array<{ doc: DocCandidate; reason: string }> = [];
  for (const doc of docs) {
    const verdict = verdicts.get(doc.path);
    if (!verdict || verdict.include) included.push(doc);
    else skipped.push({ doc, reason: verdict.reason });
  }
  return { included, skipped };
}

async function classifyOne(
  repoRoot: string,
  doc: DocCandidate,
  runner: RelevanceRunner,
): Promise<RelevanceVerdict> {
  const cacheKey = computeCacheKey(doc);
  const cached = readCache(repoRoot, cacheKey);
  if (cached) return cached;
  const verdict = await runner({ doc });
  writeCache(repoRoot, cacheKey, verdict);
  return verdict;
}

// ---------------------------------------------------------------------------
// Subprocess runner
// ---------------------------------------------------------------------------

export const RELEVANCE_SYSTEM_PROMPT = `You are a documentation relevance classifier. Given a markdown file's path and content preview, decide whether it is SPEC SOURCE material (a doc that describes the system's contracts, behaviour, or design) or NOT (a doc that's operational, internal-process, or AI-tooling).

INCLUDE (spec-source material):
  - PRDs / product requirement docs
  - ADRs / architecture decision records
  - RFCs / design proposals
  - Spec docs / API specifications
  - README files that describe what the system does or how to use it
  - Module-level design docs ("auth.md", "data-model.md", etc.)
  - Auth infrastructure docs, deployment docs that describe contracts
  - Pipeline / workflow guides

SKIP (not spec-source material):
  - Task lists / todo files
  - Release notes / changelog drafts
  - Audit / review tasks
  - Engineering research logs ("user-story-N-repo-discovery.md", "investigation-X.md")
  - AI agent instructions ("CLAUDE.md", "AGENTS.md", "prompt.md")
  - Personal engineering journals ("engineering-reset.md", "ralph-notes.md")
  - LLM prompt templates
  - Internal Slack-export-style dumps

WHEN IN DOUBT: include. Dropping a real spec doc costs more than keeping noise (the merger has rules to deprioritize uncurated material).

Output ONLY a JSON object:

  { "include": true|false, "reason": "short explanation" }

The reason will be shown to the user in the dashboard — be specific ("research log under scripts/ralph/research/", "release-notes draft under tasks/") so they can verify the call.`;

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
// Cache
// ---------------------------------------------------------------------------

interface RelevanceCacheEntry {
  cacheKey: string;
  verdict: RelevanceVerdict;
  cachedAt: string;
}

const RelevanceCacheFileSchema = z.object({
  entries: z.array(
    z.object({
      cacheKey: z.string(),
      verdict: z.object({
        path: z.string(),
        include: z.boolean(),
        reason: z.string(),
      }),
      cachedAt: z.string(),
    }),
  ),
});

const PROMPT_FINGERPRINT = createHash('sha256')
  .update(RELEVANCE_SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 16);

function computeCacheKey(doc: DocCandidate): string {
  return createHash('sha256')
    .update(`${PROMPT_FINGERPRINT}::${doc.path}::${doc.contentHash}`)
    .digest('hex');
}

function cacheFile(repoRoot: string): string {
  return path.join(cachePaths(repoRoot).cacheDir, CACHE_FILE);
}

function readCache(repoRoot: string, cacheKey: string): RelevanceVerdict | null {
  const file = cacheFile(repoRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = RelevanceCacheFileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf-8')));
    const entry = raw.entries.find((e) => e.cacheKey === cacheKey);
    return entry ? entry.verdict : null;
  } catch {
    return null;
  }
}

function writeCache(repoRoot: string, cacheKey: string, verdict: RelevanceVerdict): void {
  ensureCacheDirs(repoRoot);
  const file = cacheFile(repoRoot);
  let entries: RelevanceCacheEntry[] = [];
  if (fs.existsSync(file)) {
    try {
      entries = RelevanceCacheFileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf-8'))).entries;
    } catch {
      entries = [];
    }
  }
  const filtered = entries.filter((e) => e.cacheKey !== cacheKey);
  filtered.push({ cacheKey, verdict, cachedAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify({ entries: filtered }, null, 2) + '\n');
}
