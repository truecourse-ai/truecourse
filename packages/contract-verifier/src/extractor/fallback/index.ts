/**
 * Fallback extractor dispatcher. Runs the per-language coalescing-shape
 * matcher over every parsed source file and returns deduped
 * `ExtractedFallback` records.
 *
 * Dedup key: the derived `identity` (`<field>.fallback`) — the same field's
 * fallback duplicated across files collapses to one record. First source
 * location wins.
 */

import { eachParsedSource, jsMatchers, type LanguageMatchers } from '../source-walker.js';
import type { ExtractedFallback } from './types.js';
import { extractFallbacksFromFile } from './ts-fallbacks.js';
import { extractPyFallbacksFromFile } from './py-fallbacks.js';
import { extractCsFallbacksFromFile } from './cs-fallbacks.js';

export type { ExtractedFallback } from './types.js';

const MATCHERS: LanguageMatchers<ExtractedFallback> = {
  ...jsMatchers((s) => extractFallbacksFromFile(s.filePath, s.source, s.tree)),
  python: (s) => extractPyFallbacksFromFile(s.filePath, s.source, s.tree),
  csharp: (s) => extractCsFallbacksFromFile(s.filePath, s.source, s.tree),
};

export async function extractFallbacksFromDir(rootDir: string): Promise<ExtractedFallback[]> {
  const raw: ExtractedFallback[] = [];
  await eachParsedSource(rootDir, (s) => {
    const matcher = MATCHERS[s.lang];
    if (matcher) raw.push(...matcher(s));
  });

  const seen = new Map<string, ExtractedFallback>();
  for (const r of raw) {
    if (!seen.has(r.identity)) seen.set(r.identity, r);
  }
  return Array.from(seen.values());
}
