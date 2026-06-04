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

import { spawn } from 'node:child_process';
import { resolveClaudeBinary } from '@truecourse/shared';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Conflict } from './types.js';
import { cachePaths, ensureCacheDirs } from './cache.js';
import { buildModelArgs } from './model-args.js';

const CACHE_FILE = 'conflict-resolutions.json';

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
    spawnConflictResolverRunner({ model: opts.model, fallbackModel: opts.fallbackModel });
  const concurrency = opts.concurrency ?? 2;
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
  const cached = readCache(repoRoot, cacheKey);
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
  writeCache(repoRoot, cacheKey, final);
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
  opts: { bin?: string; timeoutMs?: number; model?: string; fallbackModel?: string } = {},
): ConflictResolverRunner {
  const bin = opts.bin ?? resolveClaudeBinary();
  const timeoutMs = opts.timeoutMs ?? 240_000;
  const modelArgs = buildModelArgs(opts.model, opts.fallbackModel);
  return (input: ConflictResolverInput): Promise<ConflictResolution> => {
    const args = [
      '-p',
      buildResolverUserPrompt(input.conflict),
      ...modelArgs,
      '--output-format',
      'json',
      '--append-system-prompt',
      CONFLICT_RESOLVER_SYSTEM_PROMPT,
      '--setting-sources',
      'project',
    ];
    return new Promise<ConflictResolution>((resolve, reject) => {
      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`conflict-resolver: claude timed out after ${timeoutMs}ms`));
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
          reject(new Error(`conflict-resolver: claude exited ${code}: ${Buffer.concat(stderr).toString('utf-8')}`));
          return;
        }
        try {
          const envelope = JSON.parse(Buffer.concat(stdout).toString('utf-8'));
          const text = typeof envelope === 'string' ? envelope : envelope.result;
          if (typeof text !== 'string') {
            reject(new Error('conflict-resolver: claude returned no text'));
            return;
          }
          const inner = JSON.parse(stripCodeFences(text));
          resolve(ConflictResolutionSchema.parse(inner));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });
  };
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const m = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return m ? m[1] : trimmed;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface ResolutionCacheEntry {
  cacheKey: string;
  resolution: ConflictResolution;
  cachedAt: string;
}

const ResolutionCacheFileSchema = z.object({
  entries: z.array(
    z.object({
      cacheKey: z.string(),
      resolution: z.object({
        pick: z.number().int(),
        confidence: z.enum(['high', 'medium', 'low']),
        reasoning: z.string(),
      }),
      cachedAt: z.string(),
    }),
  ),
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

function cacheFile(repoRoot: string): string {
  return path.join(cachePaths(repoRoot).cacheDir, CACHE_FILE);
}

function readCache(repoRoot: string, cacheKey: string): ConflictResolution | null {
  const file = cacheFile(repoRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = ResolutionCacheFileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf-8')));
    const entry = raw.entries.find((e) => e.cacheKey === cacheKey);
    return entry ? entry.resolution : null;
  } catch {
    return null;
  }
}

function writeCache(repoRoot: string, cacheKey: string, resolution: ConflictResolution): void {
  ensureCacheDirs(repoRoot);
  const file = cacheFile(repoRoot);
  let entries: ResolutionCacheEntry[] = [];
  if (fs.existsSync(file)) {
    try {
      entries = ResolutionCacheFileSchema.parse(JSON.parse(fs.readFileSync(file, 'utf-8'))).entries;
    } catch {
      entries = [];
    }
  }
  const filtered = entries.filter((e) => e.cacheKey !== cacheKey);
  filtered.push({ cacheKey, resolution, cachedAt: new Date().toISOString() });
  fs.writeFileSync(file, JSON.stringify({ entries: filtered }, null, 2) + '\n');
}
