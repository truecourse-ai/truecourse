/**
 * Slice cache. Persists per-slice extraction results under
 * `.truecourse/.cache/extractor/`. Read on every `truecourse contracts
 * generate` run so unchanged slices avoid LLM calls; written when a
 * slice's content hash isn't already on disk.
 *
 * The cache is content-addressed via slice id (see `slicer.sliceHash`),
 * so cache hits tolerate spec moves and repo renames as long as the
 * heading path + text are unchanged.
 *
 * The cache lives under the shared `.truecourse/.cache/` umbrella
 * alongside the consolidator's cache. Pre-rename layouts used
 * `.truecourse/spec-cache/` — that path is no longer read, and any
 * stragglers can be deleted; the cache rebuilds on next run.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ExtractionResult, Manifest, SliceCacheEntry, SpecSlice } from './types.js';
import { ManifestSchema, SliceCacheEntrySchema } from './types.js';
import { SYSTEM_PROMPT } from './prompt.js';

const CACHE_DIR = path.join('.truecourse', '.cache', 'extractor');
const SLICES_SUBDIR = 'slices';
const MANIFEST_FILE = 'manifest.json';

/**
 * Fingerprint of the extraction prompt. Cached slice entries record
 * the fingerprint they were extracted under; on read we treat a
 * mismatch as a miss. Prompt edits then self-invalidate the cache
 * — no manual cache bust required.
 */
const EXTRACTION_PROMPT_FINGERPRINT = createHash('sha256')
  .update(SYSTEM_PROMPT)
  .digest('hex')
  .slice(0, 16);

export interface CachePaths {
  cacheDir: string;
  slicesDir: string;
  manifestPath: string;
}

export function cachePaths(repoRoot: string): CachePaths {
  const cacheDir = path.join(repoRoot, CACHE_DIR);
  return {
    cacheDir,
    slicesDir: path.join(cacheDir, SLICES_SUBDIR),
    manifestPath: path.join(cacheDir, MANIFEST_FILE),
  };
}

export function ensureCacheDirs(repoRoot: string): CachePaths {
  const paths = cachePaths(repoRoot);
  fs.mkdirSync(paths.slicesDir, { recursive: true });
  return paths;
}

// ---------------------------------------------------------------------------
// Slice entries
// ---------------------------------------------------------------------------

export function readSliceEntry(repoRoot: string, sliceId: string): SliceCacheEntry | null {
  const file = path.join(cachePaths(repoRoot).slicesDir, `${sliceId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    const entry = SliceCacheEntrySchema.parse(raw);
    if (entry.promptFingerprint !== EXTRACTION_PROMPT_FINGERPRINT) return null;
    return entry;
  } catch {
    // Malformed cache entry — treat as a miss so the next run rewrites it.
    return null;
  }
}

export function writeSliceEntry(
  repoRoot: string,
  slice: SpecSlice,
  result: ExtractionResult,
): SliceCacheEntry {
  ensureCacheDirs(repoRoot);
  const entry: SliceCacheEntry = {
    id: slice.id,
    specPath: slice.specPath,
    headingPath: slice.headingPath,
    lineRange: slice.lineRange,
    result,
    cachedAt: new Date().toISOString(),
    promptFingerprint: EXTRACTION_PROMPT_FINGERPRINT,
  };
  const file = path.join(cachePaths(repoRoot).slicesDir, `${slice.id}.json`);
  fs.writeFileSync(file, JSON.stringify(entry, null, 2));
  return entry;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export function readManifest(repoRoot: string): Manifest | null {
  const file = cachePaths(repoRoot).manifestPath;
  if (!fs.existsSync(file)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return ManifestSchema.parse(raw);
  } catch {
    return null;
  }
}

export function writeManifest(repoRoot: string, manifest: Manifest): void {
  ensureCacheDirs(repoRoot);
  const file = cachePaths(repoRoot).manifestPath;
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
}

/**
 * Garbage-collect slice entries that are no longer referenced by the
 * current manifest. Called after a successful extraction run so the
 * cache directory doesn't grow unbounded as specs evolve.
 */
export function gcOrphanedSlices(repoRoot: string, manifest: Manifest): number {
  const paths = cachePaths(repoRoot);
  if (!fs.existsSync(paths.slicesDir)) return 0;
  const live = new Set<string>();
  for (const spec of Object.values(manifest.specs)) {
    for (const s of spec.slices) live.add(s.sliceId);
  }
  let removed = 0;
  for (const name of fs.readdirSync(paths.slicesDir)) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -'.json'.length);
    if (!live.has(id)) {
      fs.unlinkSync(path.join(paths.slicesDir, name));
      removed++;
    }
  }
  return removed;
}
