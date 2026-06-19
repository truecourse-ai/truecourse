/**
 * Persistence-strategy extractor — derives, per setting/field, whether it is
 * stored as a first-class schema column (`dedicated-column`) or as a key
 * inside a JSON `metadata` blob (`metadata-json`).
 *
 * Two signals, reconciled:
 *   - schema columns: scalar Prisma model fields (via `extractEntitiesFromDir`)
 *     are the `dedicated-column` set.
 *   - metadata keys: blob accesses (`metadata.foo`, `metadata["foo"]`,
 *     `{ ...metadata, foo }`) in TS/JS are the `metadata-json` candidate set.
 *
 * A column ALWAYS wins: if a field name is both a real column and read off a
 * blob somewhere, the dedicated column is the authoritative storage site.
 * A field seen only as a metadata key (and never as a column) is
 * `metadata-json`. Field-name matching is case-insensitive so a
 * `requiresReason` column reconciles with a `requiresreason` blob key.
 *
 * The result is fed to the `persistence-strategy` ArchitectureDecision
 * comparator/inference path: each record becomes an `architecture-decision`
 * with `category persistence-strategy` and `chosen dedicated-column|metadata-json`.
 */

import { extractEntitiesFromDir } from '../entity-schema/index.js';
import { eachParsedSource, jsMatchers, type LanguageMatchers } from '../source-walker.js';
import { extractMetadataKeysFromFile, type MetadataKeyHit } from './ts-metadata-keys.js';
import { extractPyMetadataKeysFromFile } from './py-metadata-keys.js';
import { extractCsMetadataKeysFromFile } from './cs-metadata-keys.js';
import type { ExtractedPersistenceStrategy } from './types.js';

export type { ExtractedPersistenceStrategy, PersistenceStrategyChoice } from './types.js';

const MATCHERS: LanguageMatchers<MetadataKeyHit> = {
  ...jsMatchers((s) => extractMetadataKeysFromFile(s.filePath, s.tree)),
  python: (s) => extractPyMetadataKeysFromFile(s.filePath, s.source, s.tree),
  csharp: (s) => extractCsMetadataKeysFromFile(s.filePath, s.source, s.tree),
};

export async function extractPersistenceStrategiesFromDir(
  rootDir: string,
): Promise<ExtractedPersistenceStrategy[]> {
  // 1. Dedicated columns: every scalar field on every schema model.
  const entities = await extractEntitiesFromDir(rootDir);
  const columns = new Map<string, { field: string; source: ExtractedPersistenceStrategy['source']; entity: string }>();
  for (const entity of entities) {
    for (const f of entity.fields) {
      const k = f.name.toLowerCase();
      if (!columns.has(k)) {
        columns.set(k, { field: f.name, source: entity.source, entity: entity.name });
      }
    }
  }

  // 2. Metadata-blob keys across all TS/JS sources.
  const metaKeys = new Map<string, MetadataKeyHit>();
  await eachParsedSource(rootDir, (s) => {
    const matcher = MATCHERS[s.lang];
    if (!matcher) return;
    for (const hit of matcher(s)) {
      const k = hit.key.toLowerCase();
      if (!metaKeys.has(k)) metaKeys.set(k, hit);
    }
  });

  // 3. Reconcile. Column wins; a metadata-only key is metadata-json.
  const out: ExtractedPersistenceStrategy[] = [];
  for (const [k, col] of columns) {
    out.push({
      field: col.field,
      chosen: 'dedicated-column',
      source: col.source,
      detail: `schema column \`${col.field}\` on model ${col.entity}`,
    });
    // A field that is BOTH a column and a blob key is still a column — the
    // blob read is incidental; do not also emit metadata-json for it.
    metaKeys.delete(k);
  }
  for (const hit of metaKeys.values()) {
    out.push({
      field: hit.key,
      chosen: 'metadata-json',
      source: hit.source,
      detail: `read from a JSON metadata blob (no dedicated column)`,
    });
  }

  // Stable order: dedicated columns first (schema order), then metadata keys,
  // each alphabetized by field for deterministic output.
  out.sort((a, b) => {
    if (a.chosen !== b.chosen) return a.chosen === 'dedicated-column' ? -1 : 1;
    return a.field < b.field ? -1 : a.field > b.field ? 1 : 0;
  });
  return out;
}
