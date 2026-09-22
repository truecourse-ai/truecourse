/**
 * The diff between two versions of a workspace corpus: the documents that
 * came and went, the ones re-tagged into other areas, the areas that appeared
 * or emptied, and the overlap flags that opened or closed. Pure — a version
 * view is the two stored corpora and this.
 */

import type { CorpusDiff } from '@truecourse/shared';
import type { CuratedCorpus } from './corpus-types.js';

/** Each document's areas, sorted, and each area's id. */
function areasByDoc(corpus: CuratedCorpus | null): Map<string, string[]> {
  const byDoc = new Map<string, string[]>();
  for (const doc of corpus?.docs ?? []) byDoc.set(doc.ref, []);
  for (const area of corpus?.areas ?? []) {
    for (const ref of area.docRefs) {
      const areas = byDoc.get(ref);
      if (areas) areas.push(area.id);
    }
  }
  for (const areas of byDoc.values()) areas.sort();
  return byDoc;
}

/** Every overlap flag as its document pair, order-free. */
function overlapPairs(corpus: CuratedCorpus | null): Set<string> {
  const pairs = new Set<string>();
  for (const area of corpus?.areas ?? []) {
    for (const overlap of area.overlaps) pairs.add([...overlap.docs].sort().join('\0'));
  }
  return pairs;
}

function onlyIn(a: Iterable<string>, b: Set<string>): string[] {
  return [...a].filter((key) => !b.has(key)).sort();
}

const sameAreas = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

export function diffCorpora(prior: CuratedCorpus | null, next: CuratedCorpus | null): CorpusDiff {
  const before = areasByDoc(prior);
  const after = areasByDoc(next);

  const retagged: CorpusDiff['docs']['retagged'] = [];
  for (const [ref, to] of after) {
    const from = before.get(ref);
    if (from && !sameAreas(from, to)) retagged.push({ ref, from, to });
  }

  const areasBefore = new Set((prior?.areas ?? []).map((a) => a.id));
  const areasAfter = new Set((next?.areas ?? []).map((a) => a.id));
  const pairsBefore = overlapPairs(prior);
  const pairsAfter = overlapPairs(next);

  return {
    docs: {
      added: onlyIn(after.keys(), new Set(before.keys())),
      removed: onlyIn(before.keys(), new Set(after.keys())),
      retagged: retagged.sort((a, b) => a.ref.localeCompare(b.ref)),
    },
    areas: {
      added: onlyIn(areasAfter, areasBefore),
      removed: onlyIn(areasBefore, areasAfter),
    },
    conflicts: {
      opened: onlyIn(pairsAfter, pairsBefore).length,
      closed: onlyIn(pairsBefore, pairsAfter).length,
    },
  };
}
