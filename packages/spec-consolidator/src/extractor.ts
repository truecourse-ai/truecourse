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
  /** Hooks for progress UIs / logging. */
  onDocStart?: (doc: DocCandidate) => void;
  onDocDone?: (doc: DocCandidate, blockCount: number, claimCount: number) => void;
  onBlockFailure?: (block: Block, error: string) => void;
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
  const docs = discoverDocs(rootDir, opts);

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
    return { claims: [], failures: [], blocksAttempted: 0, docsScanned: docs.length };
  }

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
