/**
 * Plain-English conflict explanations.
 *
 * The dashboard's structured-diff view (JSON path + values) is precise
 * but unreadable for non-engineers. This module asks an LLM to write
 * a short 1–3 sentence summary of how the candidates differ, so a PM
 * or product owner can decide a conflict without reading raw JSON.
 *
 * Per-conflict LLM call, cached by `(conflictId,
 * candidateFingerprint, promptFingerprint)` so re-runs with unchanged
 * candidates cost zero tokens. Failures degrade gracefully — when the
 * runner errors, the conflict still surfaces, just without the
 * explanation.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getLlmTransport } from '@truecourse/llm';
import type { Conflict } from './types.js';
import { cachePaths, ensureCacheDirs } from './cache.js';

const CACHE_FILE = 'conflict-explanations.json';

export interface ConflictExplainerInput {
  conflict: Conflict;
}

export type ConflictExplainerRunner = (
  input: ConflictExplainerInput,
) => Promise<string>;

export interface ConflictExplainerOptions {
  /** Override the runner. Tests pass a stub. */
  runner?: ConflictExplainerRunner;
  /** When false, skip the LLM calls entirely. */
  enabled?: boolean;
  /** Cap on concurrent LLM calls (default: 4). */
  concurrency?: number;
  /** Model name forwarded to the default spawn runner. */
  model?: string;
  /** Fallback model forwarded to the default spawn runner. */
  fallbackModel?: string;
  /** Fires once before any explanation work begins. */
  onStart?: (total: number) => void;
  /** Fires once per conflict after the explanation completes (or is reused from cache / errors). */
  onDone?: () => void;
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

/**
 * Attach `explanation` text to every conflict that doesn't already
 * have one. Cached per-conflict by candidate fingerprint so unchanged
 * conflicts skip the LLM call.
 *
 * Mutates the input array in place to keep the call sites simple —
 * the explanation is just a render-only enrichment, not a structural
 * change.
 */
export async function explainConflicts(
  repoRoot: string,
  conflicts: Conflict[],
  opts: ConflictExplainerOptions = {},
): Promise<void> {
  if (opts.enabled === false) return;
  if (conflicts.length === 0) return;
  const runner =
    opts.runner ??
    spawnConflictExplainerRunner({ model: opts.model, fallbackModel: opts.fallbackModel });
  const concurrency = opts.concurrency ?? 4;
  opts.onStart?.(conflicts.length);

  // Hand-rolled limit (no need for an extra dep just for this).
  let active = 0;
  let cursor = 0;
  await new Promise<void>((resolve) => {
    const launch = (): void => {
      while (active < concurrency && cursor < conflicts.length) {
        const conflict = conflicts[cursor++];
        if (conflict.explanation) {
          opts.onDone?.();
          if (cursor >= conflicts.length && active === 0) resolve();
          continue;
        }
        active++;
        explainOne(repoRoot, conflict, runner)
          .catch(() => undefined)
          .finally(() => {
            opts.onDone?.();
            active--;
            if (cursor >= conflicts.length && active === 0) resolve();
            else launch();
          });
      }
      if (cursor >= conflicts.length && active === 0) resolve();
    };
    launch();
  });
}

async function explainOne(
  repoRoot: string,
  conflict: Conflict,
  runner: ConflictExplainerRunner,
): Promise<void> {
  const cacheKey = computeCacheKey(conflict);
  const cached = readCache(repoRoot, cacheKey);
  if (cached !== null) {
    conflict.explanation = cached;
    return;
  }
  try {
    const text = await runner({ conflict });
    const trimmed = sanitize(text);
    if (trimmed.length > 0) {
      conflict.explanation = trimmed;
      writeCache(repoRoot, cacheKey, trimmed);
    }
  } catch {
    // Silent — explanation is best-effort enrichment.
  }
}

function sanitize(text: string): string {
  return text
    .trim()
    .replace(/^```(?:\w+)?\s*\n?/, '')
    .replace(/\n?```\s*$/, '')
    .trim();
}

// ---------------------------------------------------------------------------
// Subprocess runner
// ---------------------------------------------------------------------------

export const CONFLICT_EXPLAINER_SYSTEM_PROMPT = `You explain documentation conflicts in PLAIN ENGLISH so a non-engineer can decide which version to keep.

INPUT: a conflict with multiple candidates. Each candidate has:
  - source file
  - doc kind (PRD, ADR, README, …)
  - last touched timestamp
  - structured content (JSON)
  - lifecycle status (shipped / deferred / out-of-scope / …)

OUTPUT: 1–3 short sentences in plain English. Describe what each candidate says about the conflict subject. Mention sources by base filename only (e.g. "v1 PRD", "the README"). Highlight the substantive disagreement — what changes if one candidate wins vs another. NEVER include JSON, code, or technical schema syntax. NEVER refer to fields by JSON path.

Examples of good output:

  "v1 PRD says the API is unauthenticated. v2 PRD says all /api/* endpoints require a Bearer JWT, with /health exempt. Picking v2 makes auth mandatory across the surface."

  "The README lists three loyalty tiers (standard, silver, gold). The research log adds a fourth tier 'platinum'. If the research is accurate, customer records will need the additional enum value."

Rules:

  1. Output ONLY the prose. No prefix like "Explanation:". No code blocks. No lists. No headings.
  2. 1–3 sentences total. If you can't summarize in 3 sentences, the output is too long.
  3. Stay specific to THIS conflict's substance. Don't add general advice.
  4. Mention what's lost if the user picks one candidate over another, when that information is in the content.`;

/**
 * Chain-conflict explainer: candidates aren't structured claim values
 * — each candidate is an entire doc the model thinks supersedes the
 * next. The reader already sees a "VERSION CHAIN" badge; the
 * explanation's job is to say WHAT EACH DOC IS ABOUT and what changes
 * between them, so the reader can decide whether the newer really
 * replaces the older.
 */
export const CHAIN_EXPLAINER_SYSTEM_PROMPT = `You explain version-chain decisions in PLAIN ENGLISH.

The user is looking at two (or more) whole documents that the system thinks form a version chain — one is a candidate successor of the other. They already know it's a chain (shown with a "VERSION CHAIN" badge). Your job is to help them decide which doc is canonical by summarizing what each doc covers and what materially changes between them.

INPUT: a conflict with N candidates ordered oldest → newest. Each candidate is a whole doc with:
  - source file path + base name
  - doc kind (PRD, ADR, README, runbook, design-note, …)
  - last touched timestamp
  - how many claims that doc contributed to the corpus
  - which topics those claims cover (auth / endpoints / data / errors / effects / overview)
  - up to 8 representative claim subjects from that doc
  - a free-text preview of the doc's opening

OUTPUT: 2–4 short sentences in plain English, structured as:

  1. What the older doc is about (one sentence — its scope or intent).
  2. What the newer doc adds, removes, or changes (one or two sentences — be concrete).
  3. The practical implication of picking the newer (or merging) — what specifically gets dropped if the older is superseded.

Examples of good output:

  "PRD_DATA_COMPLIANCE_V1.md is a prototype spec — a CSV-backed dashboard with no auth and a frontend-only stack. backend_PRDv2.md, dated 5 days later, replaces it with a real RDS backend, Auth0 JWTs across /api/*, and three new endpoints (/api/v1/infractions, /api/v1/signatures, /api/v1/jobs). Picking V2 drops V1's 12 'no-auth' and 'CSV-only' claims; merging keeps both definitions in tension."

  "auth.md is the design-note Q&A on session storage; auth_v2.md is the ADR adopting Auth0. The ADR adds the JWT scheme, /health bypass, and 401-on-missing-token contract; the design-note is a discussion thread without binding decisions. Picking auth_v2 drops the older Q&A's 4 deliberation claims; the ADR's 9 claims become canonical."

Rules:

  1. Output ONLY the prose. No prefix like "Explanation:". No code blocks. No lists. No headings.
  2. 2–4 sentences total.
  3. Always name doc filenames (e.g. "PRD_DATA_COMPLIANCE_V1.md") so the reader can find them.
  4. When claimCount or topic stats are 0 / missing for one side, say so plainly ("V1 contributed no extractable claims — only narrative prose").
  5. If the reason both docs were chained isn't obvious from the previews (no explicit "supersedes" wording, no filename versioning), acknowledge that ("the link is inferred from topic overlap, not stated explicitly").
  6. Never speculate about content that isn't in the input. If the preview is too short to tell, say "preview is too brief to compare in detail."`;

/**
 * Chain conflicts are synthesized in the orchestrator with a
 * `subject` that always starts with "version chain:" and candidates
 * whose claim.id starts with "version-chain:". Either signal works;
 * the subject is what humans see, so we use that.
 */
export function isChainConflict(conflict: Conflict): boolean {
  if (conflict.subject.startsWith('version chain:')) return true;
  return conflict.candidates[0]?.claim.id.startsWith('version-chain:') ?? false;
}

function buildExplainerUserPrompt(conflict: Conflict): string {
  const parts: string[] = [];
  parts.push(`Conflict subject: ${conflict.subject}`);
  parts.push(`Conflict topic: ${conflict.topic}`);
  parts.push(`Candidates: ${conflict.candidates.length}`);
  parts.push('');
  for (let i = 0; i < conflict.candidates.length; i++) {
    const c = conflict.candidates[i];
    const claim = c.claim;
    const basename = claim.provenance.file.split('/').pop() ?? claim.provenance.file;
    parts.push(`--- candidate ${i + 1} ---`);
    parts.push(`source: ${claim.provenance.file} (${basename})`);
    parts.push(`docKind: ${claim.metadata.docKind}`);
    parts.push(`lastTouched: ${claim.metadata.lastTouched}`);
    if (claim.metadata.status) parts.push(`status: ${claim.metadata.status}`);
    if (claim.kind) parts.push(`kind: ${claim.kind}`);
    parts.push(`content: ${truncateJson(claim.content)}`);
    parts.push('');
  }
  parts.push('Write the 1–3 sentence plain-English explanation now.');
  return parts.join('\n');
}

interface ChainCandidateContent {
  file?: string;
  detectedFrom?: 'filename' | 'llm' | 'manual';
  preview?: string;
  claimCount?: number;
  topics?: Record<string, number>;
  subjects?: string[];
}

function buildChainExplainerUserPrompt(conflict: Conflict): string {
  const parts: string[] = [];
  parts.push(`Version-chain decision: ${conflict.subject}`);
  parts.push(`Candidates: ${conflict.candidates.length} (ordered oldest → newest)`);
  parts.push('');
  for (let i = 0; i < conflict.candidates.length; i++) {
    const c = conflict.candidates[i];
    const claim = c.claim;
    const content = (claim.content ?? {}) as ChainCandidateContent;
    const filePath = content.file ?? claim.provenance.file;
    const basename = filePath.split('/').pop() ?? filePath;
    parts.push(`--- candidate ${i + 1} (${c.weight}) ---`);
    parts.push(`source: ${filePath} (${basename})`);
    parts.push(`docKind: ${claim.metadata.docKind}`);
    parts.push(`lastTouched: ${claim.metadata.lastTouched}`);
    parts.push(`chain detected from: ${content.detectedFrom ?? 'unknown'}`);
    parts.push(`claimCount: ${content.claimCount ?? 0}`);
    if (content.topics && Object.keys(content.topics).length > 0) {
      parts.push(`topic breakdown: ${JSON.stringify(content.topics)}`);
    }
    if (content.subjects && content.subjects.length > 0) {
      parts.push(`sample subjects: ${content.subjects.join(' / ')}`);
    }
    if (content.preview) {
      const trimmed = content.preview.split('\n').slice(0, 30).join('\n');
      parts.push('preview:');
      parts.push(trimmed);
    }
    parts.push('');
  }
  parts.push(
    'Write the 2–4 sentence plain-English explanation now. Cover what each doc is about, what changes between them, and what gets dropped if the newer supersedes the older.',
  );
  return parts.join('\n');
}

function truncateJson(value: unknown, max = 1500): string {
  const s = JSON.stringify(value);
  if (s === undefined) return '(none)';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function spawnConflictExplainerRunner(
  opts: { timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): ConflictExplainerRunner {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  return async (input: ConflictExplainerInput): Promise<string> => {
    const chain = isChainConflict(input.conflict);
    const { text } = await getLlmTransport().completeText({
      system: chain ? CHAIN_EXPLAINER_SYSTEM_PROMPT : CONFLICT_EXPLAINER_SYSTEM_PROMPT,
      prompt: chain
        ? buildChainExplainerUserPrompt(input.conflict)
        : buildExplainerUserPrompt(input.conflict),
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      timeoutMs,
      label: `conflict-explain:${input.conflict.id}`,
      cliArgs: ['--setting-sources', 'project'],
    });
    return text;
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface ExplanationCacheEntry {
  cacheKey: string;
  explanation: string;
  cachedAt: string;
}

const ExplanationCacheFileSchema = z.object({
  entries: z.array(
    z.object({
      cacheKey: z.string(),
      explanation: z.string(),
      cachedAt: z.string(),
    }),
  ),
});

const CONTENT_PROMPT_FINGERPRINT = createHash('sha256')
  .update(CONFLICT_EXPLAINER_SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 16);

const CHAIN_PROMPT_FINGERPRINT = createHash('sha256')
  .update(CHAIN_EXPLAINER_SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 16);

function computeCacheKey(conflict: Conflict): string {
  const fp = isChainConflict(conflict)
    ? CHAIN_PROMPT_FINGERPRINT
    : CONTENT_PROMPT_FINGERPRINT;
  const ids = conflict.candidates.map((c) => c.claim.id).sort().join(',');
  return createHash('sha256').update(`${fp}::${conflict.id}::${ids}`).digest('hex');
}

function cacheFile(repoRoot: string): string {
  return path.join(cachePaths(repoRoot).cacheDir, CACHE_FILE);
}

function readCache(repoRoot: string, cacheKey: string): string | null {
  const file = cacheFile(repoRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = ExplanationCacheFileSchema.parse(
      JSON.parse(fs.readFileSync(file, 'utf-8')),
    );
    const entry = raw.entries.find((e) => e.cacheKey === cacheKey);
    return entry ? entry.explanation : null;
  } catch {
    return null;
  }
}

function writeCache(repoRoot: string, cacheKey: string, explanation: string): void {
  ensureCacheDirs(repoRoot);
  const file = cacheFile(repoRoot);
  let entries: ExplanationCacheEntry[] = [];
  if (fs.existsSync(file)) {
    try {
      entries = ExplanationCacheFileSchema.parse(
        JSON.parse(fs.readFileSync(file, 'utf-8')),
      ).entries;
    } catch {
      entries = [];
    }
  }
  const filtered = entries.filter((e) => e.cacheKey !== cacheKey);
  filtered.push({ cacheKey, explanation, cachedAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify({ entries: filtered }, null, 2) + '\n');
}
