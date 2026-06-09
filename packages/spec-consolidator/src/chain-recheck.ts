/**
 * Conflict-triggered chain re-check.
 *
 * The deterministic and LLM-augmented chain detectors run BEFORE the
 * merger. The LLM detector only sees the first 30 lines of each doc,
 * which isn't enough to link two PRDs with unrelated filenames (the
 * Compliance project's `PRD_DATA_COMPLIANCE_V1.md` vs `backend_PRDv2.md`
 * case — same project, same auth surface, but the LLM didn't link them
 * from previews alone).
 *
 * This module runs AFTER the initial merge. For each open conflict
 * where two+ PRD-kind candidates disagree on a cross-cutting subject
 * (auth scheme, error envelope, pagination, idempotency policy), we
 * make a focused LLM call passing BOTH docs' full content and ask:
 * "is one a successor of the other?" If yes, synthesize a manual-style
 * chain so the older doc's claims drop out of the corpus.
 *
 * Cached by (older + newer + content fingerprints) — a confirmed
 * supersession sticks across re-runs.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { cliTransport, stripCodeFences, type LlmTransport } from '@truecourse/shared/llm';
import type { Conflict, DocKind } from './types.js';
import type { DocCandidate } from './discovery.js';
import type { VersionChain } from './version-chain.js';

const CACHE_NAME = 'consolidator/chain-recheck';

/**
 * Subjects that warrant a chain re-check when two PRDs disagree.
 * These are the cross-cutting decisions where v1/v2 typically split:
 * v1's auth scheme replaced by v2's, v1's response shape replaced by
 * v2's, etc. Per-endpoint or per-entity disagreements don't trigger
 * — those are normal evolution within one project's lifetime.
 */
const FUNDAMENTAL_SUBJECTS = [
  /\bauth\b/i,
  /\bauthentication\b/i,
  /\bauthorization\b/i,
  /\benvelope\b/i,
  /\bpagination\b/i,
  /\bidempotenc/i,
  /\berror\s+codes?\b/i,
  /\bscheme\b/i,
];

function isFundamentalSubject(subject: string): boolean {
  return FUNDAMENTAL_SUBJECTS.some((re) => re.test(subject));
}

export interface ChainRecheckCandidatePair {
  /** Conflict id this pair originates from — used in logs only. */
  conflictId: string;
  /** Conflict subject — used in the LLM prompt for context. */
  subject: string;
  older: DocCandidate;
  newer: DocCandidate;
}

export interface ChainRecheckRunnerInput {
  pair: ChainRecheckCandidatePair;
  /** Full text of the older doc (read from disk by the caller). */
  olderContent: string;
  /** Full text of the newer doc (read from disk by the caller). */
  newerContent: string;
}

export interface ChainRecheckResult {
  /** Whether the LLM confirmed a supersession. */
  superseded: boolean;
  /** When superseded, which path is the older / superseded doc. */
  olderPath?: string;
  /** When superseded, which path is the newer / authoritative doc. */
  newerPath?: string;
  /** Human-readable rationale surfaced in logs / dashboard. */
  reason: string;
}

export type ChainRecheckRunner = (
  input: ChainRecheckRunnerInput,
) => Promise<ChainRecheckResult>;

export interface ChainRecheckOptions {
  /** Override the runner. Defaults to spawning the Claude CLI. */
  runner?: ChainRecheckRunner;
  /**
   * LLM transport for the default runner. Defaults to `cliTransport()`
   * (spawns `claude -p`). The CLI/dashboard pass `agentTransport(io)` for
   * headless/routine runs.
   */
  transport?: LlmTransport;
  /** When false, skip the LLM calls entirely. Useful for tests. */
  enabled?: boolean;
  /** Cap on concurrent LLM calls (default: 2). */
  concurrency?: number;
  /** Model name forwarded to the default spawn runner. */
  model?: string;
  /** Fallback model forwarded to the default spawn runner. */
  fallbackModel?: string;
}

// ---------------------------------------------------------------------------
// Pair selection — pick conflicts worth a re-check
// ---------------------------------------------------------------------------

/**
 * For each open conflict, identify pairs of PRD-kind candidates from
 * different source files that warrant a chain re-check. One pair per
 * (older, newer) by lastTouched ordering; skip pairs we've already
 * chained.
 */
export function selectRecheckPairs(
  openConflicts: Conflict[],
  docs: DocCandidate[],
  existingChainPaths: Set<string>,
): ChainRecheckCandidatePair[] {
  const docsByPath = new Map(docs.map((d) => [d.path, d]));
  const out: ChainRecheckCandidatePair[] = [];
  const seenPairs = new Set<string>(existingChainPaths);

  for (const conflict of openConflicts) {
    if (!isFundamentalSubject(conflict.subject)) continue;
    // Collect PRD-kind candidates' unique file paths.
    const prdFiles = new Set<string>();
    for (const cand of conflict.candidates) {
      if (cand.claim.metadata.docKind !== 'prd') continue;
      prdFiles.add(cand.claim.provenance.file);
    }
    if (prdFiles.size < 2) continue;

    // All combinations of 2 PRD files — pair them oldest → newest by
    // lastTouched. Skip self-pairs and already-chained pairs.
    const prdDocs = [...prdFiles]
      .map((p) => docsByPath.get(p))
      .filter((d): d is DocCandidate => d !== undefined)
      .sort((a, b) => (a.lastTouched < b.lastTouched ? -1 : 1));

    for (let i = 0; i < prdDocs.length; i++) {
      for (let j = i + 1; j < prdDocs.length; j++) {
        const older = prdDocs[i];
        const newer = prdDocs[j];
        const pairKey = `${older.path}|${newer.path}`;
        if (seenPairs.has(pairKey)) continue;
        seenPairs.add(pairKey);
        out.push({
          conflictId: conflict.id,
          subject: conflict.subject,
          older,
          newer,
        });
      }
    }
  }
  return out;
}

/**
 * Compute the set of "already chained" file-pair keys so the re-check
 * doesn't re-evaluate pairs that an earlier detector already linked.
 */
export function existingChainPairKeys(chains: VersionChain[]): Set<string> {
  const out = new Set<string>();
  for (const chain of chains) {
    for (let i = 0; i < chain.docs.length; i++) {
      for (let j = i + 1; j < chain.docs.length; j++) {
        out.add(`${chain.docs[i].path}|${chain.docs[j].path}`);
        out.add(`${chain.docs[j].path}|${chain.docs[i].path}`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

/**
 * Run the re-check on a set of conflict pairs. Reads each doc's full
 * content from disk and calls the runner. Returns the confirmed
 * supersessions as `VersionChain` objects with `detectedFrom: 'llm'`
 * (re-check is an LLM-derived signal, just from a different prompt
 * than the upfront detector).
 *
 * Cached at the pair level so re-running with the same docs +
 * contents reuses the LLM's previous verdict.
 */
export async function runChainRecheck(
  repoRoot: string,
  pairs: ChainRecheckCandidatePair[],
  opts: ChainRecheckOptions = {},
): Promise<VersionChain[]> {
  if (opts.enabled === false) return [];
  if (pairs.length === 0) return [];

  const runner =
    opts.runner ??
    spawnChainRecheckRunner({
      transport: opts.transport,
      model: opts.model,
      fallbackModel: opts.fallbackModel,
    });
  const confirmedChains: VersionChain[] = [];

  for (const pair of pairs) {
    // In-memory body when present (connector/RAM source); else read the file.
    const olderContent = pair.older.content ?? readSafe(pair.older.absPath);
    const newerContent = pair.newer.content ?? readSafe(pair.newer.absPath);
    if (olderContent === null || newerContent === null) continue;

    const cacheKey = computePairCacheKey(pair, olderContent, newerContent);
    const cached = await readPairCache(repoRoot, cacheKey);
    const result =
      cached ?? (await safeRun(runner, { pair, olderContent, newerContent }));
    if (!cached) await writePairCache(repoRoot, cacheKey, result);

    if (!result.superseded || !result.olderPath || !result.newerPath) continue;
    if (result.olderPath === result.newerPath) continue;

    confirmedChains.push(
      makeChain(pair.older, pair.newer, result.olderPath, result.newerPath),
    );
  }
  return confirmedChains;
}

function readSafe(absPath: string): string | null {
  try {
    return fs.readFileSync(absPath, 'utf-8');
  } catch {
    return null;
  }
}

async function safeRun(
  runner: ChainRecheckRunner,
  input: ChainRecheckRunnerInput,
): Promise<ChainRecheckResult> {
  try {
    return await runner(input);
  } catch {
    return { superseded: false, reason: 'runner error' };
  }
}

function makeChain(
  docA: DocCandidate,
  docB: DocCandidate,
  olderPath: string,
  newerPath: string,
): VersionChain {
  // Resolve LLM's stated older/newer back to the candidate docs.
  const olderDoc =
    docA.path === olderPath ? docA : docB.path === olderPath ? docB : docA;
  const newerDoc =
    docA.path === newerPath ? docA : docB.path === newerPath ? docB : docB;
  const docs = [olderDoc, newerDoc];
  const id = createHash('sha256')
    .update(docs.map((d) => d.path).sort().join('|'))
    .digest('hex');
  return { id, docs, detectedFrom: 'llm' };
}

// ---------------------------------------------------------------------------
// Subprocess runner — spawn `claude -p` with both docs' full content
// ---------------------------------------------------------------------------

export const CHAIN_RECHECK_SYSTEM_PROMPT = `You are a documentation-history analyzer. The caller has two docs from the same project that appear to disagree on a cross-cutting decision (auth scheme, error envelope, pagination policy, etc.). Your job is to determine whether ONE is a SUPERSEDED VERSION of the other — i.e. the project moved from doc A's design to doc B's design, and doc A should no longer be treated as authoritative.

Output ONLY a JSON object, no prose:

  { "superseded": true|false, "olderPath": "...", "newerPath": "...", "reason": "short explanation" }

Be CONSERVATIVE — the cost of a wrong supersession is losing real claims from the older doc. Strong signals:

  - One doc explicitly says it replaces / supersedes / deprecates the other
  - Filename versioning (v1.md / v2.md) where the prefixes don't match (the deterministic detector misses these but they're still supersessions)
  - Same project, same surface, but one doc describes the "old way" the other doc explicitly rewrites
  - Significant time gap between docs AND the newer doc covers a strict superset of the older's surface

Weak signals (NOT enough on their own):

  - Just newer mtime
  - Just different topics
  - Just different docKinds

When NOT superseded:

  - Two PRDs covering different surfaces of the same project (frontend PRD vs backend PRD)
  - A README + a detailed spec (the README is overview, not superseded)
  - A doc and its runbook
  - Two genuinely-alternative designs no decision has resolved

When in doubt, return \`{ "superseded": false, "reason": "..." }\`. The user has a manual escape hatch via "Mark as superseded" in the dashboard.`;

function buildChainRecheckUserPrompt(input: ChainRecheckRunnerInput): string {
  return [
    `Conflict subject: ${input.pair.subject}`,
    '',
    `Doc A — ${input.pair.older.path} (kind: ${input.pair.older.kind}, lastTouched: ${input.pair.older.lastTouched})`,
    '--- doc A content ---',
    input.olderContent,
    '--- end doc A ---',
    '',
    `Doc B — ${input.pair.newer.path} (kind: ${input.pair.newer.kind}, lastTouched: ${input.pair.newer.lastTouched})`,
    '--- doc B content ---',
    input.newerContent,
    '--- end doc B ---',
    '',
    'Question: is one of these docs a superseded version of the other? Return the JSON object as specified by the system prompt.',
  ].join('\n');
}

const ChainRecheckResultSchema = z.object({
  superseded: z.boolean(),
  olderPath: z.string().optional(),
  newerPath: z.string().optional(),
  reason: z.string().default(''),
});

function spawnChainRecheckRunner(
  opts: {
    transport?: LlmTransport;
    bin?: string;
    timeoutMs?: number;
    model?: string;
    fallbackModel?: string;
  } = {},
): ChainRecheckRunner {
  const transport = opts.transport ?? cliTransport({ bin: opts.bin });
  const timeoutMs = opts.timeoutMs ?? 180_000;
  return async (input: ChainRecheckRunnerInput): Promise<ChainRecheckResult> => {
    const raw = await transport({
      id: `spec.chainRecheck:${input.pair.conflictId}`,
      stage: 'spec.chainRecheck',
      model: opts.model,
      fallbackModel: opts.fallbackModel,
      system: CHAIN_RECHECK_SYSTEM_PROMPT,
      user: buildChainRecheckUserPrompt(input),
      responseFormat: 'json',
      timeoutMs,
    });
    const inner = JSON.parse(stripCodeFences(raw));
    return ChainRecheckResultSchema.parse(inner);
  };
}

// ---------------------------------------------------------------------------
// Cache — per-pair, invalidated when content changes
// ---------------------------------------------------------------------------

const PROMPT_FINGERPRINT = createHash('sha256')
  .update(CHAIN_RECHECK_SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 16);

function computePairCacheKey(
  pair: ChainRecheckCandidatePair,
  olderContent: string,
  newerContent: string,
): string {
  const olderHash = createHash('sha256').update(olderContent).digest('hex').slice(0, 16);
  const newerHash = createHash('sha256').update(newerContent).digest('hex').slice(0, 16);
  return createHash('sha256')
    .update(`${PROMPT_FINGERPRINT}::${pair.older.path}|${olderHash}::${pair.newer.path}|${newerHash}`)
    .digest('hex');
}

// Per-pair, content-addressed (key folds in both docs' content hashes), via the
// pluggable KV seam (Postgres in EE, file in OSS).
async function readPairCache(scope: string, cacheKey: string): Promise<ChainRecheckResult | null> {
  const raw = await getCacheEntry(scope, CACHE_NAME, cacheKey);
  if (raw === null) return null;
  const parsed = ChainRecheckResultSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

async function writePairCache(
  scope: string,
  cacheKey: string,
  result: ChainRecheckResult,
): Promise<void> {
  await setCacheEntry(scope, CACHE_NAME, cacheKey, result);
}

// Re-export so tests can use it directly without importing from index.
export type { Conflict, DocKind };
