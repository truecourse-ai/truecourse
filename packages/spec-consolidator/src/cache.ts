/**
 * Cache + persisted state for the consolidator. Files live under
 * `.truecourse/.cache/consolidator/` and are content-addressed so they
 * survive renames, moves, and re-runs as long as the inputs are
 * unchanged.
 *
 *   blocks/<blockId>.json      one extracted-block result
 *                                key = block.id (already sha256 of
 *                                       filePath + headingPath + text)
 *
 *   scan-state.json            the most recent scan result — what the
 *                                dashboard renders on mount before any
 *                                refresh. Overwritten on every scan.
 *                                Pure derived data; safe to delete.
 *
 * On corruption (Zod fails / JSON.parse throws) the entry is dropped
 * silently — better to redo one LLM call than block the whole run.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { getCacheEntry, setCacheEntry } from '@truecourse/llm';
import { LlmExtractionSchema, SYSTEM_PROMPT, type LlmExtraction } from './prompt.js';

/**
 * Fingerprint of the extraction prompt. Stored alongside each cached
 * block extraction; when the prompt changes (e.g. we add a new
 * subject-granularity rule), the fingerprint changes and stale
 * entries become cache misses → automatic re-extraction. No manual
 * cache busting needed.
 */
const EXTRACTION_PROMPT_FINGERPRINT = createHash('sha256')
  .update(SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 16);

const CACHE_RELATIVE = path.join('.truecourse', '.cache', 'consolidator');
const BLOCKS_SUBDIR = 'blocks';

export interface CachePaths {
  cacheDir: string;
  blocksDir: string;
}

export function cachePaths(repoRoot: string): CachePaths {
  const cacheDir = path.join(repoRoot, CACHE_RELATIVE);
  return {
    cacheDir,
    blocksDir: path.join(cacheDir, BLOCKS_SUBDIR),
  };
}

export function ensureCacheDirs(repoRoot: string): CachePaths {
  const paths = cachePaths(repoRoot);
  fs.mkdirSync(paths.blocksDir, { recursive: true });
  return paths;
}

// ---------------------------------------------------------------------------
// Block cache — per-block LLM extraction results
// ---------------------------------------------------------------------------

const BlockCacheEntrySchema = z.object({
  blockId: z.string(),
  /** Verbatim copy of LlmExtraction. Keeps the cache self-validating. */
  extraction: LlmExtractionSchema,
  cachedAt: z.string(),
  /**
   * Fingerprint of the SYSTEM_PROMPT that produced this entry.
   * Optional for backward-compat: entries written before this field
   * was added simply omit it, which we treat as a stale cache miss
   * so they re-extract under the current prompt.
   */
  promptFingerprint: z.string().optional(),
});
export type BlockCacheEntry = z.infer<typeof BlockCacheEntrySchema>;

/** Cache name (= file subpath under `.truecourse/.cache/`) for block entries. */
const BLOCK_CACHE_NAME = `consolidator/${BLOCKS_SUBDIR}`;

export async function readBlockCache(
  repoRoot: string,
  blockId: string,
): Promise<LlmExtraction | null> {
  const raw = await getCacheEntry(repoRoot, BLOCK_CACHE_NAME, blockId);
  if (raw === null) return null;
  try {
    const entry = BlockCacheEntrySchema.parse(raw);
    if (entry.promptFingerprint !== EXTRACTION_PROMPT_FINGERPRINT) return null;
    return entry.extraction;
  } catch {
    return null;
  }
}

export async function writeBlockCache(
  repoRoot: string,
  blockId: string,
  extraction: LlmExtraction,
): Promise<void> {
  const entry: BlockCacheEntry = {
    blockId,
    extraction,
    cachedAt: new Date().toISOString(),
    promptFingerprint: EXTRACTION_PROMPT_FINGERPRINT,
  };
  await setCacheEntry(repoRoot, BLOCK_CACHE_NAME, blockId, entry);
}

// ---------------------------------------------------------------------------
// Scan-state persistence — the dashboard's mount-time read source
// ---------------------------------------------------------------------------

/**
 * The shape persisted to `scan-state.json`. Mirrors what the
 * dashboard's `/spec/scan` endpoint returns, plus a timestamp so the
 * UI can show "scanned X minutes ago" freshness.
 *
 * We intentionally store the API-response shape (not the raw merge
 * result) so the dashboard can serve `GET /spec/scan-state` directly
 * from the file without re-marshalling. Free invariant: the in-memory
 * scan output and the on-disk persisted output are always identical
 * — what you see after a fresh scan is exactly what reload will
 * render.
 */
export interface ScanState {
  scannedAt: string;
  docsScanned: number;
  blocksAttempted: number;
  claimsExtracted: number;
  resolved: number;
  decided: number;
  /** Open conflicts with `candidateFingerprint` already attached. */
  openConflicts: unknown[];
  /** Decided conflicts in the same shape the API exposes. */
  decidedConflicts: unknown[];
  /**
   * Docs the LLM relevance filter excluded from claim extraction.
   * Each carries a short reason for the dashboard's review panel.
   * Absent on older scan-state files; readers should default to [].
   */
  skippedDocs?: Array<{ path: string; reason: string }>;
}

const SCAN_STATE_FILE = 'scan-state.json';

export function scanStatePath(repoRoot: string): string {
  return path.join(cachePaths(repoRoot).cacheDir, SCAN_STATE_FILE);
}

export function readScanState(repoRoot: string): ScanState | null {
  const file = scanStatePath(repoRoot);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as ScanState;
    // Light shape check — the dashboard tolerates extra fields, but
    // we want to fail closed if the file got truncated or written by
    // an older format we don't understand.
    if (typeof raw.scannedAt !== 'string') return null;
    if (!Array.isArray(raw.openConflicts) || !Array.isArray(raw.decidedConflicts)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeScanState(repoRoot: string, state: ScanState): void {
  ensureCacheDirs(repoRoot);
  const file = scanStatePath(repoRoot);
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + '\n');
}

export function clearScanState(repoRoot: string): void {
  const file = scanStatePath(repoRoot);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}
