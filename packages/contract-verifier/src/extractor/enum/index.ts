/**
 * Enum extractor dispatcher. Runs the per-language enum-shape matcher
 * over every parsed source file and returns deduped `ExtractedEnum`
 * records.
 *
 * Dedup key: `(name, sorted-values)` — the same enum often appears as
 * both a type alias AND a Zod schema validating it; collapse them.
 */

import { eachParsedSource, jsMatchers, type LanguageMatchers } from '../source-walker.js';
import type { ExtractedEnum } from './types.js';
import { extractEnumsFromFile } from './ts-enums.js';
import { extractPyEnumsFromFile } from './py-enums.js';

export type { ExtractedEnum, EnumShape } from './types.js';

const MATCHERS: LanguageMatchers<ExtractedEnum> = {
  ...jsMatchers((s) => extractEnumsFromFile(s.filePath, s.source, s.tree)),
  python: (s) => extractPyEnumsFromFile(s.filePath, s.source, s.tree),
};

export async function extractEnumsFromDir(rootDir: string): Promise<ExtractedEnum[]> {
  const raw: ExtractedEnum[] = [];
  await eachParsedSource(rootDir, (s) => {
    const matcher = MATCHERS[s.lang];
    if (matcher) raw.push(...matcher(s));
  });

  // Dedup by (name, value-set).
  const seen = new Map<string, ExtractedEnum>();
  for (const e of raw) {
    const key = `${e.name}|${e.values.join(',')}`;
    if (!seen.has(key)) seen.set(key, e);
  }
  return Array.from(seen.values());
}
