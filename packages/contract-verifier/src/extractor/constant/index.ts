/**
 * Constant extractor dispatcher. Runs the per-language constant-shape
 * matcher over every parsed source file and returns deduped
 * `ExtractedConstant` records.
 *
 * Dedup key: `(name, stringified value)` — same constant in multiple
 * files collapses to one record. The first source location wins.
 */

import { eachParsedSource, jsMatchers, type LanguageMatchers } from '../source-walker.js';
import type { ExtractedConstant } from './types.js';
import { extractConstantsFromFile } from './ts-constants.js';
import { extractPyConstantsFromFile } from './py-constants.js';
import { extractCsConstantsFromFile } from './cs-constants.js';

export type { ExtractedConstant, ConstantShape } from './types.js';

const MATCHERS: LanguageMatchers<ExtractedConstant> = {
  ...jsMatchers((s) => extractConstantsFromFile(s.filePath, s.source, s.tree)),
  python: (s) => extractPyConstantsFromFile(s.filePath, s.source, s.tree),
  csharp: (s) => extractCsConstantsFromFile(s.filePath, s.source, s.tree),
};

export async function extractConstantsFromDir(rootDir: string): Promise<ExtractedConstant[]> {
  const raw: ExtractedConstant[] = [];
  await eachParsedSource(rootDir, (s) => {
    const matcher = MATCHERS[s.lang];
    if (matcher) raw.push(...matcher(s));
  });

  // Dedup by (name, serialized-value). Keep first occurrence.
  const seen = new Map<string, ExtractedConstant>();
  for (const c of raw) {
    const key = `${c.name}|${JSON.stringify(c.value)}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  return Array.from(seen.values());
}
