/**
 * LLM-based version chain detection.
 *
 * Complement to the deterministic detector, which only catches
 * filename versioning (foo_v1.md → foo_v2.md). Real-world docs
 * rarely follow that convention, so we also ask the model to
 * identify version relationships from content + filenames + mtimes.
 * The LLM receives a compact summary of every discovered doc
 * (path, kind, lastTouched, preview) and returns ordered chains it
 * believes form a supersession.
 *
 * The two detectors run in parallel and their chains are merged
 * (deduped by member-path set). Anything the deterministic path
 * finds is kept as-is; anything the LLM adds carries
 * `detectedFrom: 'llm'` so the dashboard can label it.
 *
 * Cached by `sha256(sorted doc paths + lastTouched + preview hash)`
 * — re-running a scan with unchanged docs costs zero LLM calls.
 */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { DocCandidate } from './discovery.js';
import type { VersionChain } from './version-chain.js';
import { cachePaths, ensureCacheDirs } from './cache.js';

const CACHE_FILE = 'chain-detection.json';

export interface ChainDetectionInput {
  path: string;
  docKind: DocCandidate['kind'];
  lastTouched: string;
  preview: string;
}

export interface ChainRunnerOptions {
  bin?: string;
  timeoutMs?: number;
}

/**
 * Pluggable runner — production spawns `claude -p`; tests can inject
 * a stub that returns canned chains without an LLM call.
 */
export type ChainRunner = (
  inputs: ChainDetectionInput[],
) => Promise<DetectedChainOutput>;

export interface DetectChainsOptions {
  /** Override the runner. Defaults to spawning the Claude CLI. */
  runner?: ChainRunner;
  /** When false, skip the LLM call entirely. Useful for tests. */
  enabled?: boolean;
}

export interface DetectedChainOutput {
  chains: Array<{
    /** Ordered list of repo-relative doc paths, oldest → newest. */
    members: string[];
    /** Short human-readable reason — surfaced in the dashboard tooltip. */
    reason: string;
  }>;
}

const DetectedChainOutputSchema = z.object({
  chains: z.array(
    z.object({
      members: z.array(z.string().min(1)).min(2),
      reason: z.string().default(''),
    }),
  ),
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run LLM chain detection over the discovered docs. Returns `[]` when
 * `enabled === false`, the cache has a hit, or the LLM finds nothing.
 *
 * The returned chains use `detectedFrom: 'llm'` and reference the
 * same `DocCandidate` objects the caller passed in (so downstream
 * code keeps full provenance, not just the path string).
 */
export async function detectVersionChainsViaLlm(
  repoRoot: string,
  docs: DocCandidate[],
  opts: DetectChainsOptions = {},
): Promise<VersionChain[]> {
  if (opts.enabled === false) return [];
  if (docs.length < 2) return [];

  const inputs: ChainDetectionInput[] = docs.map((d) => ({
    path: d.path,
    docKind: d.kind,
    lastTouched: d.lastTouched,
    // Cap to first 30 lines so the prompt stays small even with big docs.
    preview: d.preview.split('\n').slice(0, 30).join('\n'),
  }));

  const cacheKey = computeCacheKey(inputs);
  const cached = readChainDetectionCache(repoRoot, cacheKey);
  if (cached) return materializeChains(cached, docs);

  const runner = opts.runner ?? spawnChainRunner();
  let result: DetectedChainOutput;
  try {
    result = await runner(inputs);
  } catch {
    // LLM failure shouldn't break the scan — fall back to whatever
    // the deterministic detector found. The user simply won't get
    // LLM-augmented chains this run.
    return [];
  }

  writeChainDetectionCache(repoRoot, cacheKey, result);
  return materializeChains(result, docs);
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const CHAIN_DETECTION_SYSTEM_PROMPT = `You analyze a set of documentation files and identify VERSION CHAINS — pairs or groups where one doc clearly supersedes another.

A version chain exists when one doc is a direct successor of another covering the same subject. Real-world signals include:

  - "Replaces" / "deprecates" / "previous version" wording in the new doc.
  - Filename versioning (foo_v1.md → foo_v2.md, SPEC.md → SPEC-2.md).
  - One doc is a more detailed rewrite of another in the same directory, with the older one's content largely subsumed.
  - One doc references the other by path as a prior version.

Be CONSERVATIVE. Do NOT chain:

  - A PRD and an ADR (different document kinds describing different things).
  - An overview README and a detailed spec.
  - Two docs covering related but distinct subjects (orders.md vs customers.md).
  - A doc and a runbook for the same system.

When unsure, omit the chain — false positives lose user trust.

INPUT: a JSON array of docs, each with { path, docKind, lastTouched, preview }.

OUTPUT: a single JSON object, no prose, no code fences:

{
  "chains": [
    {
      "members": ["docs/PRDs/foo_v1.md", "docs/PRDs/foo_v2.md"],
      "reason": "filename versioning suggests v2 supersedes v1"
    }
  ]
}

Order members oldest → newest. Use empty array if no chains. Be specific in "reason" — name the signal you used.`;

export function buildChainDetectionUserPrompt(inputs: ChainDetectionInput[]): string {
  const summary = inputs.map((d) => ({
    path: d.path,
    docKind: d.docKind,
    lastTouched: d.lastTouched,
    preview: d.preview,
  }));
  return [
    'Identify version chains in the following docs.',
    '',
    JSON.stringify(summary, null, 2),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Subprocess runner
// ---------------------------------------------------------------------------

function spawnChainRunner(opts: ChainRunnerOptions = {}): ChainRunner {
  const bin = opts.bin ?? process.env.CLAUDE_CODE_BIN ?? 'claude';
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return async (inputs) => {
    const args = [
      '-p',
      buildChainDetectionUserPrompt(inputs),
      '--output-format',
      'json',
      '--append-system-prompt',
      CHAIN_DETECTION_SYSTEM_PROMPT,
      '--setting-sources',
      'project',
    ];
    return new Promise<DetectedChainOutput>((resolve, reject) => {
      const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`chain-detection: claude timed out after ${timeoutMs}ms`));
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
          reject(new Error(`chain-detection: claude exited ${code}: ${Buffer.concat(stderr).toString('utf-8')}`));
          return;
        }
        try {
          const envelope = JSON.parse(Buffer.concat(stdout).toString('utf-8'));
          const text = typeof envelope === 'string' ? envelope : envelope.result;
          if (typeof text !== 'string') {
            reject(new Error('chain-detection: claude returned no text'));
            return;
          }
          const inner = JSON.parse(stripCodeFences(text));
          resolve(DetectedChainOutputSchema.parse(inner));
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    });
  };
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = /^```(?:json|JSON)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return fenceMatch ? fenceMatch[1] : trimmed;
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface ChainDetectionCacheEntry {
  cacheKey: string;
  result: DetectedChainOutput;
  cachedAt: string;
}

/**
 * Cache key includes a fingerprint of the system prompt. When the
 * prompt changes (e.g., we tighten the conservative rule), every
 * cache entry self-invalidates and we re-detect with the new
 * instructions.
 */
const PROMPT_FINGERPRINT = createHash('sha256')
  .update(CHAIN_DETECTION_SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 16);

function computeCacheKey(inputs: ChainDetectionInput[]): string {
  const sorted = [...inputs].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const material = sorted
    .map((d) => `${d.path}|${d.lastTouched}|${createHash('sha256').update(d.preview).digest('hex')}`)
    .join('\n');
  return createHash('sha256')
    .update(`${PROMPT_FINGERPRINT}::${material}`)
    .digest('hex');
}

function readChainDetectionCache(repoRoot: string, cacheKey: string): DetectedChainOutput | null {
  const file = path.join(cachePaths(repoRoot).cacheDir, CACHE_FILE);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as ChainDetectionCacheEntry;
    if (raw.cacheKey !== cacheKey) return null;
    return DetectedChainOutputSchema.parse(raw.result);
  } catch {
    return null;
  }
}

function writeChainDetectionCache(
  repoRoot: string,
  cacheKey: string,
  result: DetectedChainOutput,
): void {
  ensureCacheDirs(repoRoot);
  const file = path.join(cachePaths(repoRoot).cacheDir, CACHE_FILE);
  const entry: ChainDetectionCacheEntry = {
    cacheKey,
    result,
    cachedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(entry, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Materialization — map LLM output back to typed VersionChain objects
// ---------------------------------------------------------------------------

function materializeChains(
  result: DetectedChainOutput,
  docs: DocCandidate[],
): VersionChain[] {
  const byPath = new Map(docs.map((d) => [d.path, d]));
  const out: VersionChain[] = [];
  for (const chain of result.chains) {
    const members = chain.members
      .map((p) => byPath.get(p))
      .filter((d): d is DocCandidate => d != null);
    // Discard chains where the LLM hallucinated a path or referenced
    // fewer than two real docs — better to drop a chain than chain
    // garbage.
    if (members.length < 2) continue;
    const id = createHash('sha256')
      .update(members.map((d) => d.path).sort().join('|'))
      .digest('hex');
    out.push({ id, docs: members, detectedFrom: 'llm' });
  }
  return out;
}
