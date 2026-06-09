/**
 * Enum extractor dispatcher. Runs the per-language enum-shape matcher
 * over every parsed source file and returns deduped `ExtractedEnum`
 * records.
 *
 * Dedup key: `(name, sorted-values)` — the same enum often appears as
 * both a type alias AND a Zod schema validating it; collapse them.
 */

import path from 'node:path';
import { eachParsedSource, jsMatchers, type LanguageMatchers } from '../source-walker.js';
import type { ExtractedEnum } from './types.js';
import { extractEnumsFromFile, extractIdLiteralFromExport } from './ts-enums.js';
import { extractPyEnumsFromFile } from './py-enums.js';
import { extractCsEnumsFromFile } from './cs-enums.js';

export type { ExtractedEnum, EnumShape } from './types.js';

const MATCHERS: LanguageMatchers<ExtractedEnum> = {
  ...jsMatchers((s) => extractEnumsFromFile(s.filePath, s.source, s.tree)),
  python: (s) => extractPyEnumsFromFile(s.filePath, s.source, s.tree),
  csharp: (s) => extractCsEnumsFromFile(s.filePath, s.source, s.tree),
};

export async function extractEnumsFromDir(rootDir: string): Promise<ExtractedEnum[]> {
  const raw: ExtractedEnum[] = [];
  // groupDir → list of (idValue, filePath) for sibling index.ts handler synthesis
  const siblingIds = new Map<string, Array<{ value: string; filePath: string }>>();

  await eachParsedSource(rootDir, (s) => {
    const matcher = MATCHERS[s.lang];
    if (matcher) raw.push(...matcher(s));

    // Collect id-literal per index.ts for cross-file sibling synthesis.
    // Only TS/JS index files are candidates; Python modules use different conventions.
    const base = path.basename(s.filePath);
    if ((base === 'index.ts' || base === 'index.js') && s.lang === 'typescript') {
      const idVal = extractIdLiteralFromExport(s.filePath, s.source, s.tree);
      if (idVal !== null) {
        // Group by grandparent dir: each sibling lives at <group>/<name>/index.ts
        const groupDir = path.dirname(path.dirname(s.filePath));
        const list = siblingIds.get(groupDir) ?? [];
        list.push({ value: idVal, filePath: s.filePath });
        siblingIds.set(groupDir, list);
      }
    }
  });

  // Synthesise one enum per sibling group that has ≥3 members.
  // Name = basename of the group directory (e.g. `operations`, `processors`).
  // This lets the comparator match it by substring/value-set against contracts
  // like `OperationType` or `ProcessorKind`.
  for (const [groupDir, entries] of siblingIds) {
    if (entries.length < 3) continue;
    raw.push({
      name: path.basename(groupDir),
      values: [...new Set(entries.map((e) => e.value))].sort(),
      shape: 'sibling-id-literal',
      source: { filePath: entries[0].filePath, lineStart: 1, lineEnd: 1 },
    });
  }

  // Dedup by (name, value-set).
  const seen = new Map<string, ExtractedEnum>();
  for (const e of raw) {
    const key = `${e.name}|${e.values.join(',')}`;
    if (!seen.has(key)) seen.set(key, e);
  }
  return Array.from(seen.values());
}
