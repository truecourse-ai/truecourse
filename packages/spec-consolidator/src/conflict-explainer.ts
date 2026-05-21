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

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
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
  const runner = opts.runner ?? spawnConflictExplainerRunner();
  const concurrency = opts.concurrency ?? 4;

  // Hand-rolled limit (no need for an extra dep just for this).
  let active = 0;
  let cursor = 0;
  await new Promise<void>((resolve) => {
    const launch = (): void => {
      while (active < concurrency && cursor < conflicts.length) {
        const conflict = conflicts[cursor++];
        if (conflict.explanation) {
          if (cursor >= conflicts.length && active === 0) resolve();
          continue;
        }
        active++;
        explainOne(repoRoot, conflict, runner)
          .catch(() => undefined)
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

function truncateJson(value: unknown, max = 1500): string {
  const s = JSON.stringify(value);
  if (s === undefined) return '(none)';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function spawnConflictExplainerRunner(
  opts: { bin?: string; timeoutMs?: number } = {},
): ConflictExplainerRunner {
  const bin = opts.bin ?? process.env.CLAUDE_CODE_BIN ?? 'claude';
  const timeoutMs = opts.timeoutMs ?? 90_000;
  return (input: ConflictExplainerInput): Promise<string> => {
    const args = [
      '-p',
      buildExplainerUserPrompt(input.conflict),
      '--output-format',
      'json',
      '--append-system-prompt',
      CONFLICT_EXPLAINER_SYSTEM_PROMPT,
      '--setting-sources',
      'project',
    ];
    return new Promise<string>((resolve, reject) => {
      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`conflict-explainer: claude timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      proc.stdout.on('data', (b: Buffer) => stdout.push(b));
      proc.stderr.on('data', (b: Buffer) => stderr.push(b));
      proc.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error(`conflict-explainer: claude exited ${code}: ${Buffer.concat(stderr).toString('utf-8')}`));
          return;
        }
        try {
          const envelope = JSON.parse(Buffer.concat(stdout).toString('utf-8'));
          const text = typeof envelope === 'string' ? envelope : envelope.result;
          if (typeof text !== 'string') {
            reject(new Error('conflict-explainer: claude returned no text'));
            return;
          }
          resolve(text);
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });
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

const PROMPT_FINGERPRINT = createHash('sha256')
  .update(CONFLICT_EXPLAINER_SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 16);

function computeCacheKey(conflict: Conflict): string {
  const ids = conflict.candidates.map((c) => c.claim.id).sort().join(',');
  return createHash('sha256')
    .update(`${PROMPT_FINGERPRINT}::${conflict.id}::${ids}`)
    .digest('hex');
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
