/**
 * Validation-rule extractor dispatcher. Runs the per-language guard-shape
 * matcher over every parsed source file and returns deduped
 * `ExtractedValidationRule` records.
 *
 * Dedup key: the derived `identity` (`<setting>.required-when.<target>`) —
 * the same guard duplicated across files collapses to one record. First
 * source location wins.
 */

import { eachParsedSource, jsMatchers, type LanguageMatchers } from '../source-walker.js';
import type { ExtractedValidationRule } from './types.js';
import { extractValidationRulesFromFile } from './ts-validation-rules.js';
import { extractPyValidationRulesFromFile } from './py-validation-rules.js';
import { extractCsValidationRulesFromFile } from './cs-validation-rules.js';

export type { ExtractedValidationRule } from './types.js';

const MATCHERS: LanguageMatchers<ExtractedValidationRule> = {
  ...jsMatchers((s) => extractValidationRulesFromFile(s.filePath, s.source, s.tree)),
  python: (s) => extractPyValidationRulesFromFile(s.filePath, s.source, s.tree),
  csharp: (s) => extractCsValidationRulesFromFile(s.filePath, s.source, s.tree),
};

export async function extractValidationRulesFromDir(
  rootDir: string,
): Promise<ExtractedValidationRule[]> {
  const raw: ExtractedValidationRule[] = [];
  await eachParsedSource(rootDir, (s) => {
    const matcher = MATCHERS[s.lang];
    if (matcher) raw.push(...matcher(s));
  });

  const seen = new Map<string, ExtractedValidationRule>();
  for (const r of raw) {
    if (!seen.has(r.identity)) seen.set(r.identity, r);
  }
  return Array.from(seen.values());
}
