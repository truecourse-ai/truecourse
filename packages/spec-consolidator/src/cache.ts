/**
 * Two-layer cache for the consolidator. Both layers live under
 * `.truecourse/.cache/consolidator/` and are content-addressed so they
 * survive renames, moves, and re-runs as long as the inputs are
 * unchanged.
 *
 *   blocks/<blockId>.json      one extracted-block result
 *                                key = block.id (already sha256 of
 *                                       filePath + headingPath + text)
 *
 *   sections/<sectionId>.json  one rendered-section markdown body
 *                                key = sha256(module + topic +
 *                                       sorted-claim-ids + claim-content-fingerprint)
 *
 * Both layers store the original inputs alongside the outputs so a
 * cache hit can be validated cheaply (the orchestrator double-checks
 * the input fingerprint before serving).
 *
 * On corruption (Zod fails / JSON.parse throws) the entry is dropped
 * silently — better to redo one LLM call than block the whole run.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Claim, Topic } from './types.js';
import { LlmExtractionSchema, type LlmExtraction } from './prompt.js';

const CACHE_RELATIVE = path.join('.truecourse', '.cache', 'consolidator');
const BLOCKS_SUBDIR = 'blocks';
const SECTIONS_SUBDIR = 'sections';

export interface CachePaths {
  cacheDir: string;
  blocksDir: string;
  sectionsDir: string;
}

export function cachePaths(repoRoot: string): CachePaths {
  const cacheDir = path.join(repoRoot, CACHE_RELATIVE);
  return {
    cacheDir,
    blocksDir: path.join(cacheDir, BLOCKS_SUBDIR),
    sectionsDir: path.join(cacheDir, SECTIONS_SUBDIR),
  };
}

export function ensureCacheDirs(repoRoot: string): CachePaths {
  const paths = cachePaths(repoRoot);
  fs.mkdirSync(paths.blocksDir, { recursive: true });
  fs.mkdirSync(paths.sectionsDir, { recursive: true });
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
});
export type BlockCacheEntry = z.infer<typeof BlockCacheEntrySchema>;

export function readBlockCache(repoRoot: string, blockId: string): LlmExtraction | null {
  const file = path.join(cachePaths(repoRoot).blocksDir, `${blockId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const entry = BlockCacheEntrySchema.parse(raw);
    return entry.extraction;
  } catch {
    return null;
  }
}

export function writeBlockCache(
  repoRoot: string,
  blockId: string,
  extraction: LlmExtraction,
): void {
  ensureCacheDirs(repoRoot);
  const entry: BlockCacheEntry = {
    blockId,
    extraction,
    cachedAt: new Date().toISOString(),
  };
  const file = path.join(cachePaths(repoRoot).blocksDir, `${blockId}.json`);
  fs.writeFileSync(file, JSON.stringify(entry, null, 2));
}

// ---------------------------------------------------------------------------
// Section cache — per-section LLM-rendered markdown
// ---------------------------------------------------------------------------

const SectionCacheEntrySchema = z.object({
  sectionId: z.string(),
  module: z.string(),
  topic: z.string(),
  fileName: z.string(),
  markdown: z.string(),
  cachedAt: z.string(),
});
export type SectionCacheEntry = z.infer<typeof SectionCacheEntrySchema>;

export interface SectionCacheKey {
  module: string;
  topic: Topic;
  fileName: string;
  /** The claims that fed this section — order doesn't matter, sorted internally. */
  claims: Claim[];
}

/**
 * Compute the content-addressed id for a (module, topic, claims)
 * triple. Independent of input order — the same set of claims, in
 * any order, produces the same id.
 */
export function sectionId(key: SectionCacheKey): string {
  const sortedClaims = [...key.claims].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const fingerprint = sortedClaims
    .map((c) => `${c.id}:${stableStringify({ content: c.content, status: c.metadata.status ?? null })}`)
    .join('|');
  return createHash('sha256')
    .update(`${key.module}::${key.topic}::${key.fileName}::${fingerprint}`)
    .digest('hex');
}

export function readSectionCache(
  repoRoot: string,
  id: string,
): string | null {
  const file = path.join(cachePaths(repoRoot).sectionsDir, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const entry = SectionCacheEntrySchema.parse(raw);
    return entry.markdown;
  } catch {
    return null;
  }
}

export function writeSectionCache(
  repoRoot: string,
  id: string,
  meta: { module: string; topic: Topic; fileName: string; markdown: string },
): void {
  ensureCacheDirs(repoRoot);
  const entry: SectionCacheEntry = {
    sectionId: id,
    module: meta.module,
    topic: meta.topic,
    fileName: meta.fileName,
    markdown: meta.markdown,
    cachedAt: new Date().toISOString(),
  };
  const file = path.join(cachePaths(repoRoot).sectionsDir, `${id}.json`);
  fs.writeFileSync(file, JSON.stringify(entry, null, 2));
}

// ---------------------------------------------------------------------------
// Stable stringify — same as merger's, dup'd here so the cache layer
// has no internal coupling on merger.ts.
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}
