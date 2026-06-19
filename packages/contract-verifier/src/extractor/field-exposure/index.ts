/**
 * Field-exposure extractor dispatcher. Runs the per-language projection /
 * response matcher over every parsed source file and returns deduped
 * `ExtractedFieldExposure` records.
 *
 * Dedup key: the derived `identity` (`<field>.exposure`). The same field
 * observed across files and channels collapses to ONE record whose
 * `exposedVia` is the UNION of every channel seen — so a field that is both
 * selected in a query and returned in a response carries
 * `['query-select','api-response']`. First source location wins.
 */

import { eachParsedSource, jsMatchers, type LanguageMatchers } from '../source-walker.js';
import type { ExtractedFieldExposure } from './types.js';
import type { FieldExposureContract } from '../../types/index.js';
import { extractFieldExposuresFromFile } from './ts-fields.js';
import { extractPyFieldExposuresFromFile } from './py-fields.js';
import { extractCsFieldExposuresFromFile } from './cs-fields.js';

export type { ExtractedFieldExposure } from './types.js';

type Channel = FieldExposureContract['exposedVia'][number];

const MATCHERS: LanguageMatchers<ExtractedFieldExposure> = {
  ...jsMatchers((s) => extractFieldExposuresFromFile(s.filePath, s.source, s.tree)),
  python: (s) => extractPyFieldExposuresFromFile(s.filePath, s.source, s.tree),
  csharp: (s) => extractCsFieldExposuresFromFile(s.filePath, s.source, s.tree),
};

export async function extractFieldExposuresFromDir(
  rootDir: string,
): Promise<ExtractedFieldExposure[]> {
  const raw: ExtractedFieldExposure[] = [];
  await eachParsedSource(rootDir, (s) => {
    const matcher = MATCHERS[s.lang];
    if (matcher) raw.push(...matcher(s));
  });

  // The walk visits files in filesystem (readdir) order, which is not stable
  // across machines. Sort the raw records by (filePath, line, identity) FIRST
  // so the "first location wins" dedup below is deterministic — the source
  // location attributed to a field is always its lexicographically-smallest
  // occurrence, never an artifact of the walk order. This makes both verify and
  // infer output reproducible (a prerequisite for byte-exact inferred goldens).
  raw.sort((a, b) =>
    a.source.filePath !== b.source.filePath
      ? (a.source.filePath < b.source.filePath ? -1 : 1)
      : a.source.lineStart !== b.source.lineStart
        ? a.source.lineStart - b.source.lineStart
        : a.source.lineEnd !== b.source.lineEnd
          ? a.source.lineEnd - b.source.lineEnd
          : (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0),
  );

  const seen = new Map<string, ExtractedFieldExposure>();
  for (const r of raw) {
    const existing = seen.get(r.identity);
    if (!existing) {
      // Copy so we can extend exposedVia without mutating the matcher's record.
      seen.set(r.identity, {
        identity: r.identity,
        contract: { ...r.contract, exposedVia: [...r.contract.exposedVia] },
        source: r.source,
      });
      continue;
    }
    // Same field seen again: union the channels (first location wins).
    for (const ch of r.contract.exposedVia) {
      if (!existing.contract.exposedVia.includes(ch)) existing.contract.exposedVia.push(ch);
    }
  }

  // Deterministic channel order so output never depends on file-walk order.
  const order: Record<Channel, number> = { 'query-select': 0, 'api-response': 1 };
  for (const rec of seen.values()) {
    rec.contract.exposedVia.sort((a, b) => order[a] - order[b]);
  }
  // Stable identity order so the returned set never depends on insertion order.
  return Array.from(seen.values()).sort((a, b) =>
    a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0,
  );
}
