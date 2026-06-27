/**
 * Deterministic area grouping (spec-scan redesign, Phase 1). Takes the kept
 * docs + the per-doc raw tags from `area-tagger.ts` and produces the corpus's
 * `CorpusDoc[]` (each with canonical area ids) and `Area[]` (docs grouped by
 * area). No LLM — re-running this against the same tags is free and stable,
 * which is what lets a wider alias map re-normalize cached tags without
 * re-tagging.
 *
 * Canonicalization (slug + synonym folding) lives in `corpus-types.ts`
 * (`normalizeArea`); this module only applies it and groups. User overrides
 * from `decisions.json#manualAreas` replace a doc's auto-tags entirely.
 */

import type { DocCandidate } from './discovery.js';
import {
  normalizeArea,
  splitArea,
  type Area,
  type CorpusDoc,
  type VocabMap,
} from './corpus-types.js';
import type { DocAreaTags } from './area-tagger.js';
import type { ManualArea } from './types.js';

export interface GroupResult {
  docs: CorpusDoc[];
  areas: Area[];
}

/**
 * Group tagged docs into the corpus's doc list + area list.
 *
 * @param docs       the kept docs (relevance-included)
 * @param tagsByPath per-doc raw tags + status, keyed by `doc.path`
 * @param manualAreas user overrides (by doc ref) that replace auto-tags
 * @param vocab      cross-doc reconciliation map (collapses drifted product/concern slugs)
 */
export function groupByArea(
  docs: DocCandidate[],
  tagsByPath: Map<string, DocAreaTags>,
  manualAreas: ManualArea[] = [],
  vocab?: VocabMap,
): GroupResult {
  const manualByDoc = new Map(manualAreas.map((m) => [m.doc, m.areas]));

  const corpusDocs: CorpusDoc[] = [];
  // area id → set of doc refs (insertion via sorted docs keeps it deterministic)
  const areaMembers = new Map<string, string[]>();

  for (const doc of docs) {
    const verdict = tagsByPath.get(doc.path);
    const override = manualByDoc.get(doc.path);

    const ids = override
      ? canonicalizeIds(override, vocab)
      : canonicalizeTags(verdict?.tags ?? [], vocab);

    corpusDocs.push({
      ref: doc.path,
      kind: doc.kind,
      status: verdict?.status,
      lastTouched: doc.lastTouched,
      areaTags: ids,
    });

    for (const id of ids) {
      const list = areaMembers.get(id) ?? [];
      list.push(doc.path);
      areaMembers.set(id, list);
    }
  }

  const areas: Area[] = [...areaMembers.entries()]
    .map(([id, docRefs]): Area => {
      const { product, concern } = splitArea(id);
      return { id, product, concern, docRefs: [...docRefs].sort(), overlaps: [] };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return { docs: corpusDocs, areas };
}

/** Normalize raw `{product, concern}` tags into a sorted, de-duped id list. */
function canonicalizeTags(tags: DocAreaTags['tags'], vocab?: VocabMap): string[] {
  const ids = new Set<string>();
  for (const tag of tags) {
    const id = normalizeArea(tag, vocab);
    if (id) ids.add(id);
  }
  return [...ids].sort();
}

/** Normalize user-supplied area-id strings (e.g. "Core/Users Entity") into canonical ids. */
function canonicalizeIds(idStrings: string[], vocab?: VocabMap): string[] {
  const ids = new Set<string>();
  for (const raw of idStrings) {
    const id = normalizeArea(splitArea(raw), vocab);
    if (id) ids.add(id);
  }
  return [...ids].sort();
}
