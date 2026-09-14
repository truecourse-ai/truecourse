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
 * INCLUSION is the sixth, and a dimension of its own: the scan keeps a document
 * or skips it, and a reader may overrule either through the workspace's
 * decisions. Hand the decisions in and the rows widen to every document Context
 * knows — the skipped ones and the excluded ones included, each carrying where
 * it stands and why. Leave them out and the rows are the corpus's kept
 * documents alone, which is what Home counts.
 *
 * Pure by construction: every store read is the caller's, which is what lets
 * the route do them once per repository rather than once per document.
 */

import {
  CONTEXT_DOCUMENT_STATUS_OF_COVERAGE,
  CONTEXT_DOCUMENT_STATUS_ORDER,
  contextInclusionOf,
  type ContextBinding,
  type ContextDocument,
  type ContextDocumentDecision,
  type ContextDocumentReading,
  type ContextDocumentRow,
  type ContextDocumentStatus,
  type ContextSource,
  type ContextSourceKind,
  type GuardCoveragePlainStatus,
} from '@truecourse/shared';
import type { CuratedCorpus } from '@truecourse/spec-consolidator';
import { contextDocRef, parseContextDocRef } from '../../lib/context-ref.js';
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
  /**
   * The workspace's inclusion decisions. Handed in, the rows widen past the
   * corpus to every document Context knows: the ones the scan skipped and the
   * ones a reader excluded. Omitted, the rows are the corpus's own documents.
   */
  decisions?: {
    manualIncludes?: readonly string[];
    manualExcludes?: readonly string[];
  };
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

/** A document the rows are to be composed for, before anything is joined to it. */
interface Candidate {
  ref: string;
  /** The source it belongs to: the corpus's stamp when it has one, else its ref. */
  sourceId: string | null;
  /** The corpus's area tag; '' for a document the corpus does not hold. */
  area: string;
  inCorpus: boolean;
  /** The scan's words for skipping it, when it skipped it. */
  skipReason: string | null;
}

/**
 * One row per document, worst first. The order is the plan's: the status order,
 * then the title, so the page opens on what is wrong — and the documents the
 * corpus does not hold come after all of them, because none of them is anybody's
 * to-do.
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

  const includes = new Set(input.decisions?.manualIncludes ?? []);
  const excludes = new Set(input.decisions?.manualExcludes ?? []);

  const rows: ContextDocumentRow[] = [];
  for (const doc of candidatesOf(input, ledger)) {
    const sourceId = doc.sourceId;
    if (!sourceId) continue;
    const source = sourceById.get(sourceId);
    const entry = ledger.get(doc.ref);
    // A document the corpus does not hold is in no repository's slice: nothing
    // reads it, so nothing has a reading of it either.
    const repositories = doc.inCorpus
      ? [...(readers.get(sourceId) ?? [])].sort((a, b) => a.localeCompare(b))
      : [];

    const readings = readingsOf(repositories, input.coverage, doc.ref);
    const decision: ContextDocumentDecision | null = excludes.has(doc.ref)
      ? 'exclude'
      : includes.has(doc.ref)
        ? 'include'
        : null;
    rows.push({
      ref: doc.ref,
      title: entry?.title || fileNameOf(doc.ref),
      area: doc.area,
      sourceId,
      // A source removed since the scan still named these documents; the ref is
      // the only name left for it, and it is a real one.
      sourceTitle: source?.title ?? sourceId,
      sourceKind: (source?.kind ?? 'repository') as ContextSourceKind,
      repositories,
      readings,
      status: !doc.inCorpus
        ? null
        : repositories.length === 0
          ? 'not-linked'
          : (readings[0]?.status ?? 'not-run'),
      inCorpus: doc.inCorpus,
      decision,
      inclusion: contextInclusionOf(doc.inCorpus, decision),
      skipReason: doc.skipReason,
      updatedAt: entry?.updatedAt ?? null,
    });
  }

  return rows.sort((a, b) => rank(a.status) - rank(b.status) || a.title.localeCompare(b.title));
}

/** Where a status sorts; a document with none sorts after every one that has one. */
function rank(status: ContextDocumentStatus | null): number {
  return status === null
    ? CONTEXT_DOCUMENT_STATUS_ORDER.length
    : CONTEXT_DOCUMENT_STATUS_ORDER.indexOf(status);
}

/**
 * The documents to compose rows for, in corpus order: the ones the corpus
 * holds, and — once the caller hands in the decisions — the ones it does not.
 * A skipped document is named by the corpus's own skip list; one the scan
 * dropped WHOLE on a reader's exclusion is named by nothing but that decision,
 * so the ledger is what says it still exists.
 */
function candidatesOf(
  input: ContextDocumentRowInput,
  ledger: ReadonlyMap<string, ContextRowDocument>,
): Candidate[] {
  const candidates: Candidate[] = input.corpus.docs.map((doc) => ({
    ref: doc.ref,
    sourceId: corpusDocSourceId(doc),
    area: doc.areaTags[0] ?? '',
    inCorpus: true,
    skipReason: null,
  }));
  if (!input.decisions) return candidates;

  const outside = (ref: string, skipReason: string | null): Candidate => ({
    ref,
    sourceId: parseContextDocRef(ref)?.sourceId ?? null,
    area: '',
    inCorpus: false,
    skipReason,
  });

  const seen = new Set(candidates.map((doc) => doc.ref));
  for (const skipped of input.corpus.skippedDocs ?? []) {
    if (seen.has(skipped.ref)) continue;
    seen.add(skipped.ref);
    candidates.push(outside(skipped.ref, skipped.reason));
  }
  const decided = [
    ...(input.decisions.manualExcludes ?? []),
    ...(input.decisions.manualIncludes ?? []),
  ];
  for (const ref of decided) {
    if (seen.has(ref) || !ledger.has(ref)) continue;
    seen.add(ref);
    candidates.push(outside(ref, null));
  }
  return candidates;
}

/**
 * What each repository says about the document, WORST FIRST — and therefore
 * what the row's own status is (its first entry). A repository that reads the
 * document but could say nothing about it yet (nothing generated, nothing run,
 * no body to join) reads Not run: it is linked, and nothing has been proven.
 */
function readingsOf(
  repositories: readonly string[],
  coverage: ReadonlyMap<string, ReadonlyMap<string, GuardCoveragePlainStatus>>,
  ref: string,
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
  inclusion?: readonly string[];
}

/**
 * AND across dimensions, OR within one — the reading every filter row has. A
 * document with no coverage status carries no value along that dimension, so
 * asking for one never answers with a document nothing was asked to prove.
 */
export function filterContextDocumentRows(
  rows: readonly ContextDocumentRow[],
  filter: ContextDocumentFilter,
): ContextDocumentRow[] {
  return rows.filter(
    (row) =>
      matches(filter.area, [row.area]) &&
      matches(filter.status, row.status ? [row.status] : []) &&
      matches(filter.source, [row.sourceId]) &&
      matches(filter.repo, row.repositories) &&
      matches(filter.inclusion, [row.inclusion]),
  );
}

function matches(wanted: readonly string[] | undefined, has: readonly string[]): boolean {
  return !wanted || wanted.length === 0 || wanted.some((value) => has.includes(value));
}
