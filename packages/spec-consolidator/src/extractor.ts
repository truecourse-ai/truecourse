/**
 * Top-level claim extractor. Wires discovery → slicing → per-block
 * runner → claim assembly. Produces the `Claim[]` the merger
 * consumes.
 *
 * Each LLM-produced claim is wrapped with the metadata the LLM
 * doesn't (and can't) generate:
 *   - `id`         — sha256(file + line + topic + subject), stable.
 *   - `provenance` — file path, line, verbatim quote of the source block.
 *   - `metadata`   — docKind + lastTouched from discovery.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import type { Block } from './slicer.js';
import { sliceDoc } from './slicer.js';
import { discoverDocs, type DocCandidate, type DiscoveryOptions } from './discovery.js';
import { spawnRunner, type BlockRunner, type BlockRunResult } from './runner.js';
import type { LlmClaim } from './prompt.js';
import type { Claim, Provenance, ClaimMetadata } from './types.js';

export interface ExtractOptions extends DiscoveryOptions {
  /** Override the runner — tests pass a stub; production uses spawnRunner(). */
  runner?: BlockRunner;
  /**
   * Pre-filtered doc set to extract from. When provided, the extractor
   * skips its own `discoverDocs` call and walks only these docs. Used
   * by the orchestrator to apply the LLM relevance filter before
   * extraction so skipped docs cost zero tokens.
   */
  docs?: DocCandidate[];
  /** Hooks for progress UIs / logging. */
  onDocStart?: (doc: DocCandidate) => void;
  onDocDone?: (doc: DocCandidate, blockCount: number, claimCount: number) => void;
  onBlockFailure?: (block: Block, error: string) => void;
  /**
   * Fired once, after slicing, with the total number of blocks the
   * runner will process. Pairs with `onBlockDone` so progress UIs can
   * show "N / total blocks" updating in real time during the long LLM
   * extraction phase. (`onDocStart`/`onDocDone` only fire on slice
   * start / final assembly — both are instantaneous, so they can't
   * drive a live progress display.)
   */
  onBlocksReady?: (total: number) => void;
}

export interface ExtractResult {
  /** All claims extracted across all docs. */
  claims: Claim[];
  /** Per-block runs that failed (subprocess error, parse, schema). */
  failures: Array<{ block: Block; error: string }>;
  /** Number of blocks attempted. */
  blocksAttempted: number;
  /** Number of docs walked. */
  docsScanned: number;
}

/**
 * Run the full extraction pipeline against `rootDir`.
 *
 *   1. Discover every markdown file (kind-classified, with provenance).
 *   2. Slice each doc into blocks (deterministic, content-addressed).
 *   3. Send all blocks through the runner in parallel.
 *   4. Wrap each LLM-produced claim with id + provenance + metadata.
 */
export async function extractClaims(
  rootDir: string,
  opts: ExtractOptions = {},
): Promise<ExtractResult> {
  const docs = opts.docs ?? discoverDocs(rootDir, opts);

  // Slice every doc and remember which doc each block came from so
  // metadata flows through correctly.
  const allBlocks: Block[] = [];
  const docByBlockId = new Map<string, DocCandidate>();
  for (const doc of docs) {
    opts.onDocStart?.(doc);
    const blocks = sliceDoc(doc.path, readFileSync(doc.absPath));
    for (const b of blocks) {
      allBlocks.push(b);
      docByBlockId.set(b.id, doc);
    }
  }

  if (allBlocks.length === 0) {
    opts.onBlocksReady?.(0);
    return { claims: [], failures: [], blocksAttempted: 0, docsScanned: docs.length };
  }

  opts.onBlocksReady?.(allBlocks.length);

  const runner = opts.runner ?? spawnRunner();
  const results: BlockRunResult[] = await runner(allBlocks);

  const claims: Claim[] = [];
  const failures: Array<{ block: Block; error: string }> = [];
  for (const r of results) {
    if (r.error || !r.extraction) {
      failures.push({ block: r.block, error: r.error ?? '(no extraction)' });
      opts.onBlockFailure?.(r.block, r.error ?? '(no extraction)');
      continue;
    }
    const doc = docByBlockId.get(r.block.id);
    if (!doc) continue; // shouldn't happen — invariant of the map build above
    for (const llmClaim of r.extraction.claims) {
      claims.push(assembleClaim(llmClaim, r.block, doc));
    }
  }

  // Per-doc done hook fires after assembly so the count is accurate.
  for (const doc of docs) {
    const docBlocks = allBlocks.filter((b) => docByBlockId.get(b.id)?.path === doc.path);
    const docClaims = claims.filter((c) => c.provenance.file === doc.path);
    opts.onDocDone?.(doc, docBlocks.length, docClaims.length);
  }

  return {
    claims,
    failures,
    blocksAttempted: allBlocks.length,
    docsScanned: docs.length,
  };
}

// ---------------------------------------------------------------------------
// Failure summarization
//
// `extractClaims` never throws on a per-block failure — a transient
// subprocess error, a parse miss, or an expired `claude` login all land in
// `failures[]` so a partial scan still yields whatever claims succeeded.
// That's correct for a few stragglers, but a *total* failure (every block
// errored → zero claims) is indistinguishable from "clean repo" unless the
// caller inspects the failures. This helper classifies them so the CLI and
// dashboard can surface the actual error messages instead of a misleading
// success.
//
// Auth is deliberately *not* sniffed here: every command that spawns `claude`
// runs the same up-front auth preflight (tools/cli/src/lib/claude-preflight.ts
// → @truecourse/core/lib/cli-binary), so a broken/expired login is caught
// before any block runs. Re-guessing it from per-block stderr afterwards would
// duplicate that check (scan-only) and be far less reliable than the live
// round-trip the preflight already does.
// ---------------------------------------------------------------------------

export interface FailureSample {
  /** The failure message. */
  message: string;
  /** How many blocks failed with this exact message. */
  count: number;
}

export interface ExtractionFailureReport {
  /** Total failed blocks. */
  total: number;
  /** True when at least one block was attempted and every one failed. */
  allFailed: boolean;
  /** Distinct failure messages, most frequent first, capped to `sampleLimit`. */
  samples: FailureSample[];
}

/**
 * Classify an extraction's failures for user-facing reporting: collapse
 * duplicate messages (152 identical errors → one line with a count) and flag a
 * total wipeout so callers can surface the real cause instead of a misleading
 * success. Pure — safe to call on every scan.
 */
export function summarizeExtractionFailures(
  result: { failures: ReadonlyArray<{ error: string }>; blocksAttempted: number },
  opts: { sampleLimit?: number } = {},
): ExtractionFailureReport {
  const { failures, blocksAttempted } = result;
  const sampleLimit = opts.sampleLimit ?? 3;

  const counts = new Map<string, number>();
  for (const f of failures) {
    counts.set(f.error, (counts.get(f.error) ?? 0) + 1);
  }
  const samples: FailureSample[] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, sampleLimit)
    .map(([message, count]) => ({ message, count }));

  return {
    total: failures.length,
    allFailed: blocksAttempted > 0 && failures.length === blocksAttempted,
    samples,
  };
}

// ---------------------------------------------------------------------------
// Claim assembly
// ---------------------------------------------------------------------------

function assembleClaim(llm: LlmClaim, block: Block, doc: DocCandidate): Claim {
  const line = llm.line ?? block.startLine;
  const id = createHash('sha256')
    .update(`${doc.path}:${line}:${llm.topic}:${llm.subject}`)
    .digest('hex');

  const provenance: Provenance = {
    file: doc.path,
    line,
    quote: shortQuote(block.text),
  };

  const metadata: ClaimMetadata = {
    docKind: doc.kind,
    status: llm.status,
    lastTouched: doc.lastTouched,
  };

  return {
    id,
    topic: llm.topic,
    subject: llm.subject,
    content: llm.content,
    kind: llm.kind,
    provenance,
    metadata,
  };
}

/**
 * Cap the verbatim quote at a reasonable length — the dashboard
 * shows it side-by-side, so 40 lines is plenty. Long blocks get
 * truncated with an ellipsis line.
 */
function shortQuote(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= 40) return text;
  return [...lines.slice(0, 40), `… (+${lines.length - 40} more lines)`].join('\n');
}

function readFileSync(absPath: string): string {
  return fs.readFileSync(absPath, 'utf-8');
}
