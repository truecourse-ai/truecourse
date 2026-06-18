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

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import type { DocCandidate } from './discovery.js';
import type { VersionChain } from './version-chain.js';

const CACHE_NAME = 'consolidator/chain-detection';

export interface ChainDetectionInput {
  path: string;
  docKind: DocCandidate['kind'];
  lastTouched: string;
  preview: string;
}

export interface ChainRunnerOptions {
  /**
   * LLM transport. Defaults to `cliTransport()` (spawns `claude -p`). The
   * CLI/dashboard pass `agentTransport(io)` for headless/routine runs.
   */
  transport?: LlmTransport;
  bin?: string;
  /** Model passed to `claude --model`. Resolved by CLI/dashboard via core. */
  model?: string;
  /** Fallback model passed to `claude --fallback-model`. */
  fallbackModel?: string;
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
  /** LLM transport for the auto-created runner (defaults to cli). */
  transport?: LlmTransport;
  /** When false, skip the LLM call entirely. Useful for tests. */
  enabled?: boolean;
  /** Model name forwarded to the default spawn runner. */
  model?: string;
  /** Fallback model forwarded to the default spawn runner. */
  fallbackModel?: string;
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
  const cached = await readChainDetectionCache(repoRoot, cacheKey);
  if (cached) return materializeChains(cached, docs);

  const runner =
    opts.runner ?? spawnChainRunner({ transport: opts.transport, model: opts.model, fallbackModel: opts.fallbackModel });
  let result: DetectedChainOutput;
  try {
    result = await runner(inputs);
  } catch {
    // LLM failure shouldn't break the scan — fall back to whatever
    // the deterministic detector found. The user simply won't get
    // LLM-augmented chains this run.
    return [];
  }

  await writeChainDetectionCache(repoRoot, cacheKey, result);
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
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 120_000;
  return async (inputs) => {
    // No single natural id for a batched call over all docs — omit `id` and
    // let the transport hash the content.
    const raw = await transport({
      stage: 'spec.chainDetect',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: CHAIN_DETECTION_SYSTEM_PROMPT,
      user: buildChainDetectionUserPrompt(inputs),
      responseFormat: 'json',
      timeoutMs,
    });
    const inner = JSON.parse(stripCodeFences(raw));
    return DetectedChainOutputSchema.parse(inner);
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

/**
 * Cache key includes a fingerprint of the system prompt. When the
 * prompt changes (e.g., we tighten the conservative rule), every
 * cache entry self-invalidates and we re-detect with the new
 * instructions. Stored via the pluggable KV seam (Postgres in EE, file in OSS)
 * — the key IS the content hash, so the KV value is the result directly.
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

async function readChainDetectionCache(scope: string, cacheKey: string): Promise<DetectedChainOutput | null> {
  const raw = await getCacheEntry(scope, CACHE_NAME, cacheKey);
  if (raw === null) return null;
  const parsed = DetectedChainOutputSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function writeChainDetectionCache(
  scope: string,
  cacheKey: string,
  result: DetectedChainOutput,
): Promise<void> {
  await setCacheEntry(scope, CACHE_NAME, cacheKey, result);
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
