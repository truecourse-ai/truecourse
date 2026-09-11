/**
 * A repository's SLICE of the workspace corpus.
 *
 * The workspace has ONE corpus over every source's documents; a repository
 * reads the sources it is LINKED to, and what it may generate scenarios from is
 * that corpus cut down to those sources' documents. The slice is derived, never
 * stored as a corpus of its own (plan §3), so this is a pure function over the
 * artifact — one place, used by the repository's corpus route AND by the job
 * that materializes the corpus into a run's clone, so the two can never show
 * the repository different documents.
 *
 * Everything that names a document is restricted together: an area keeps only
 * the docRefs it still has (and disappears when it has none), an overlap
 * survives only when BOTH its documents do (a disagreement with one side gone
 * is not this repository's disagreement), and the same holds for the
 * not-reached list and the unchecked candidate pairs.
 */

import type { CuratedCorpus } from '@truecourse/spec-consolidator';
import { parseContextDocRef } from '../../lib/context-ref.js';

/** The source a corpus doc belongs to: the stamp when it has one, else its ref. */
export function corpusDocSourceId(doc: { ref: string; sourceId?: string }): string | null {
  return doc.sourceId ?? parseContextDocRef(doc.ref)?.sourceId ?? null;
}

/**
 * The workspace corpus restricted to the documents of `sourceIds`. Returns null
 * when the slice holds no document at all — a repository linked to nothing (or
 * to sources that yielded nothing) has no spec, which is a different thing from
 * an empty corpus.
 */
export function sliceCorpus(
  corpus: CuratedCorpus,
  sourceIds: readonly string[],
): CuratedCorpus | null {
  const wanted = new Set(sourceIds);
  const inSlice = (ref: string, stamped?: string): boolean => {
    const sourceId = stamped ?? parseContextDocRef(ref)?.sourceId ?? null;
    return sourceId !== null && wanted.has(sourceId);
  };

  const docs = corpus.docs.filter((doc) => inSlice(doc.ref, doc.sourceId));
  if (docs.length === 0) return null;
  const kept = new Set(docs.map((doc) => doc.ref));

  const areas = corpus.areas
    .map((area) => {
      const docRefs = area.docRefs.filter((ref) => kept.has(ref));
      const overlaps = area.overlaps.filter(
        (overlap) => kept.has(overlap.docs[0]) && kept.has(overlap.docs[1]),
      );
      const notReached = area.notReached?.filter((ref) => kept.has(ref));
      const uncheckedPairs = area.uncheckedPairs?.filter(
        (pair) => kept.has(pair.a.doc) && kept.has(pair.b.doc),
      );
      return {
        ...area,
        docRefs,
        overlaps,
        ...(notReached ? { notReached } : {}),
        ...(uncheckedPairs ? { uncheckedPairs } : {}),
      };
    })
    .filter((area) => area.docRefs.length > 0);

  return {
    ...corpus,
    docs,
    areas,
    skippedDocs: (corpus.skippedDocs ?? []).filter((doc) => inSlice(doc.ref)),
  };
}

/** Every source id the corpus's documents name (stamped, else read off the ref). */
export function corpusSourceIds(corpus: CuratedCorpus): string[] {
  const ids = new Set<string>();
  for (const doc of corpus.docs) {
    const sourceId = corpusDocSourceId(doc);
    if (sourceId) ids.add(sourceId);
  }
  return [...ids].sort();
}
