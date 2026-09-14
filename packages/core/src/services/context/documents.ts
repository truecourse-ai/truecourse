/**
 * The rows of the Documents view — ONE row per document of the workspace
 * corpus, composed on the server (plan §5, §7).
 *
 * Context IS the documents: a source is a filter over them, and a repository is
 * a reading of them. So a row joins four stored things and invents none of
 * them — the corpus (which documents are kept, and the area each was tagged
 * with), the ledger (each document's title and when it last changed at its
 * source), the sources (the title and kind a row names), and the bindings
 * (which repositories read which source).
 *
 * The fifth is the STATUS, which is not stored anywhere: coverage is derived
 * per repository, and a document may be read by several. The caller hands in
 * each repository's already-derived reading (`coverage`), and the fold here is
 * the plan's rule — worst first across every repository that reads it, so a
 * failure in one repository is never hidden behind a proof in another, and a
 * document nobody reads is Not linked.
 *
 * Pure by construction: every store read is the caller's, which is what lets
 * the route do them once per repository rather than once per document.
 */

import {
  CONTEXT_DOCUMENT_STATUS_OF_COVERAGE,
  CONTEXT_DOCUMENT_STATUS_ORDER,
  type ContextBinding,
  type ContextDocument,
  type ContextDocumentReading,
  type ContextDocumentRow,
  type ContextDocumentStatus,
  type ContextSource,
  type ContextSourceKind,
  type GuardCoveragePlainStatus,
} from '@truecourse/shared';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';
import { contextDocRef } from '../../lib/context-ref.js';
import { corpusDocSourceId } from './slice.js';

/** Just enough of a source to name it on a row. */
export type ContextRowSource = Pick<ContextSource, 'id' | 'title' | 'kind'>;

/** Just enough of a ledger row to title and date a document. */
export type ContextRowDocument = Pick<
  ContextDocument,
  'sourceId' | 'docPath' | 'title' | 'updatedAt'
>;

export interface ContextDocumentRowInput {
  /** The workspace corpus — the document universe, and the areas. */
  corpus: CuratedCorpus;
  sources: readonly ContextRowSource[];
  documents: readonly ContextRowDocument[];
  bindings: readonly Pick<ContextBinding, 'repoFullName' | 'sourceId'>[];
  /**
   * Per repository (`owner/repo`), the coverage word each document reads
   * through it. A document absent from a repository's map is one that
   * repository could say nothing about (no body to join, nothing bound); the
   * repository simply does not vote on it.
   */
  coverage: ReadonlyMap<string, ReadonlyMap<string, GuardCoveragePlainStatus>>;
  /**
   * The repositories that may appear on a row, `owner/repo`. A binding to a
   * repository this caller cannot see (another workspace's, one disconnected
   * between two reads) names nobody and is left out. Omit to allow every
   * repository the bindings name.
   */
  visibleRepos?: ReadonlySet<string>;
}

/** The file name of a ref — the honest last resort for a title. */
function fileNameOf(ref: string): string {
  const parts = ref.split('/');
  return parts[parts.length - 1] ?? ref;
}

/** Worst first, by {@link CONTEXT_DOCUMENT_STATUS_ORDER}. */
export function worstContextStatus(
  statuses: readonly ContextDocumentStatus[],
): ContextDocumentStatus | null {
  return CONTEXT_DOCUMENT_STATUS_ORDER.find((status) => statuses.includes(status)) ?? null;
}

/**
 * One row per kept document, worst first. The order is the plan's: the status
 * order, then the title, so the page opens on what is wrong.
 */
export function composeContextDocumentRows(
  input: ContextDocumentRowInput,
): ContextDocumentRow[] {
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));

  // The ledger, keyed by the ref the corpus names it with.
  const ledger = new Map<string, ContextRowDocument>();
  for (const doc of input.documents) {
    try {
      ledger.set(contextDocRef(doc.sourceId, doc.docPath), doc);
    } catch {
      // A ledger row whose path cannot be a ref names no corpus document.
    }
  }

  const readers = new Map<string, string[]>();
  for (const binding of input.bindings) {
    if (input.visibleRepos && !input.visibleRepos.has(binding.repoFullName)) continue;
    readers.set(binding.sourceId, [...(readers.get(binding.sourceId) ?? []), binding.repoFullName]);
  }

  const rows: ContextDocumentRow[] = [];
  for (const doc of input.corpus.docs) {
    const sourceId = corpusDocSourceId(doc);
    if (!sourceId) continue;
    const source = sourceById.get(sourceId);
    const entry = ledger.get(doc.ref);
    const repositories = [...(readers.get(sourceId) ?? [])].sort((a, b) => a.localeCompare(b));

    const readings = readingsOf(doc.ref, repositories, input.coverage);
    rows.push({
      ref: doc.ref,
      title: entry?.title || fileNameOf(doc.ref),
      area: doc.areaTags[0] ?? '',
      sourceId,
      // A source removed since the scan still named these documents; the ref is
      // the only name left for it, and it is a real one.
      sourceTitle: source?.title ?? sourceId,
      sourceKind: (source?.kind ?? 'repository') as ContextSourceKind,
      repositories,
      readings,
      status:
        repositories.length === 0
          ? 'not-linked'
          : (readings[0]?.status ?? 'not-run'),
      updatedAt: entry?.updatedAt ?? null,
    });
  }

  return rows.sort(
    (a, b) =>
      CONTEXT_DOCUMENT_STATUS_ORDER.indexOf(a.status) -
        CONTEXT_DOCUMENT_STATUS_ORDER.indexOf(b.status) || a.title.localeCompare(b.title),
  );
}

/**
 * What each repository says about the document, WORST FIRST — and therefore
 * what the row's own status is (its first entry). A repository that reads the
 * document but could say nothing about it yet (nothing generated, nothing run,
 * no body to join) reads Not run: it is linked, and nothing has been proven.
 */
function readingsOf(
  ref: string,
  repositories: readonly string[],
  coverage: ReadonlyMap<string, ReadonlyMap<string, GuardCoveragePlainStatus>>,
): ContextDocumentReading[] {
  return repositories
    .map((repository) => {
      const word = coverage.get(repository)?.get(ref);
      return {
        repository,
        status: word ? CONTEXT_DOCUMENT_STATUS_OF_COVERAGE[word] : ('not-run' as const),
      };
    })
    .sort(
      (a, b) =>
        CONTEXT_DOCUMENT_STATUS_ORDER.indexOf(a.status) -
          CONTEXT_DOCUMENT_STATUS_ORDER.indexOf(b.status) ||
        a.repository.localeCompare(b.repository),
    );
}

/** The dimensions the Documents view narrows along, as the route reads them. */
export interface ContextDocumentFilter {
  area?: readonly string[];
  status?: readonly string[];
  source?: readonly string[];
  repo?: readonly string[];
}

/** AND across dimensions, OR within one — the reading every filter row has. */
export function filterContextDocumentRows(
  rows: readonly ContextDocumentRow[],
  filter: ContextDocumentFilter,
): ContextDocumentRow[] {
  return rows.filter(
    (row) =>
      matches(filter.area, [row.area]) &&
      matches(filter.status, [row.status]) &&
      matches(filter.source, [row.sourceId]) &&
      matches(filter.repo, row.repositories),
  );
}

function matches(wanted: readonly string[] | undefined, has: readonly string[]): boolean {
  return !wanted || wanted.length === 0 || wanted.some((value) => has.includes(value));
}
