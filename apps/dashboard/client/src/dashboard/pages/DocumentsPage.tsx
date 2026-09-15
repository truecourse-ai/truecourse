/**
 * Context › Documents: ONE table, one row per document the workspace's Context
 * knows, worst first. A source is a filter over it, a repository is a reading
 * of it, and the status a row wears is the server's fold across every
 * repository that reads the document (`GET /api/context/documents`) — nothing
 * here computes a status, and nothing here writes a word the server did not.
 *
 * The documents the corpus does NOT hold have rows here too, because a document
 * with no row anywhere cannot be decided about: one the scan skipped reads Not
 * included, one a reader dropped reads Excluded, and either says why. Inclusion
 * is its own dimension, never a sixth coverage word — the deciding itself is on
 * the document's own page.
 *
 * ONE filter row narrows it along five dimensions — Area, Status, Inclusion,
 * Source and Repository — and every narrowing rides the address (`?area=`,
 * `?status=`, `?inclusion=`, `?source=`, `?repo=`), so a narrowed page is a
 * place: the Sources list and the repository's Context tab link straight to
 * `?source=<id>`.
 *
 * Narrowed to exactly ONE source, the header carries that source's sync status
 * word and the crumb trail leads back through the source's own page — which is
 * where its scope is read and what can be DONE to it lives.
 *
 * The page actions — Scan and Add context — belong to the workspace, so they
 * are {@link ContextFrame}'s and every section of Context carries them.
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CONTEXT_DOCUMENT_STATUS_ORDER,
  CONTEXT_DOCUMENT_STATUS_WORD,
  CONTEXT_INCLUSION_ORDER,
  CONTEXT_INCLUSION_WORD,
  type ContextDocumentInclusion,
  type ContextDocumentRow,
  type ContextDocumentStatus,
  type ContextSourceView,
} from '@truecourse/shared';
import { IndexTable } from '@/dashboard/ui/index-table';
import {
  filterKey,
  parseFilterKey,
  selectedValues,
  type FilterDimension,
} from '@/dashboard/ui/filter-builder';
import { facetDimensions } from '@/dashboard/ui/filter-facets';
import {
  CONTEXT_SYNC_TONE,
  CONTEXT_SYNC_WORD,
  StatusWord,
  tallyOf,
} from '@/dashboard/ui/status-word';
import { formatRelativeTime } from '@truecourse/shared';
import { useContextDocuments, useContextSignal, useContextSources } from '@/dashboard/shell/use-context';
import { HoverPopover } from '@/dashboard/ui/hover-popover';
import { ContextFrame } from './ContextFrame';
import { CONTEXT_BASE, docHref, sourceHref } from './context-hrefs';
import {
  CONTEXT_ROW_WORD_ORDER,
  contextRowFact,
  contextRowWord,
  contextRowWordKey,
} from './context-inclusion';

/** The dimensions the one filter row narrows along, each its own address parameter. */
const DIMENSIONS = ['area', 'status', 'inclusion', 'source', 'repo'] as const;
type Dimension = (typeof DIMENSIONS)[number];
const DIMENSION_WORD: Record<Dimension, string> = {
  area: 'Area',
  status: 'Status',
  inclusion: 'Inclusion',
  source: 'Source',
  repo: 'Repository',
};
const isDimension = (key: string): key is Dimension =>
  (DIMENSIONS as readonly string[]).includes(key);

/**
 * The values a row has along one dimension (a document may read in several
 * repositories). A document the corpus does not hold has no coverage status, so
 * it carries no value along that dimension and no status filter answers with it.
 */
function valuesOf(row: ContextDocumentRow, dimension: Dimension): string[] {
  switch (dimension) {
    case 'area':
      return [row.area];
    case 'status':
      return row.status ? [row.status] : [];
    case 'inclusion':
      return [row.inclusion];
    case 'source':
      return [row.sourceId];
    case 'repo':
      return row.repositories;
  }
}

/** AND across dimensions, OR within one: the reading every multi-dimension filter has. */
function keeps(row: ContextDocumentRow, selected: readonly string[]): boolean {
  for (const dimension of DIMENSIONS) {
    const wanted = selectedValues(selected, dimension);
    if (wanted.length > 0 && !wanted.some((value) => valuesOf(row, dimension).includes(value))) {
      return false;
    }
  }
  return true;
}

/** What a row says under Repositories: the one that reads it, or how many do. */
function repositoriesLabel(row: ContextDocumentRow): string {
  if (row.repositories.length === 0) return '—';
  if (row.repositories.length === 1) return row.repositories[0]!;
  return `${row.repositories.length} repositories`;
}

/**
 * The one source the view is narrowed to, as a header: its sync status word.
 * What can be DONE to a source lives on the source's own page — a header is not
 * a place to hide actions, nor to spell out a scope.
 */
function SourceHeader({ source }: { source: ContextSourceView }) {
  return <StatusWord tone={CONTEXT_SYNC_TONE[source.status]} word={CONTEXT_SYNC_WORD[source.status]} />;
}

/** The document's own path inside its source: the ref minus the context prefix and the source id. */
function docPathOf(ref: string): string {
  const parts = ref.split('/');
  return parts[0] === 'context' && parts.length > 2 ? parts.slice(2).join('/') : ref;
}

export default function DocumentsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const signal = useContextSignal();
  const { documents, error } = useContextDocuments(signal);
  const { sources } = useContextSources(signal);
  const [query, setQuery] = useState('');

  const rowsAll = useMemo(() => documents ?? [], [documents]);

  // The selection lives in the address: one parameter per dimension.
  const selected = useMemo(
    () =>
      DIMENSIONS.flatMap((dimension) =>
        searchParams
          .getAll(dimension)
          .filter(Boolean)
          .map((value) => filterKey(dimension, value)),
      ),
    [searchParams],
  );

  const select = useCallback(
    (next: string[]) => {
      const params = new URLSearchParams(searchParams);
      for (const dimension of DIMENSIONS) params.delete(dimension);
      for (const key of next) {
        const parsed = parseFilterKey(key);
        if (parsed && isDimension(parsed.dimension)) params.append(parsed.dimension, parsed.value);
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const matchesQuery = useCallback(
    (row: ContextDocumentRow) => {
      const q = query.trim().toLowerCase();
      return q === '' || row.title.toLowerCase().includes(q);
    },
    [query],
  );

  const dimensions = useMemo<FilterDimension[]>(() => {
    const areas = [...new Set(rowsAll.map((row) => row.area))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const repositories = [...new Set(rowsAll.flatMap((row) => row.repositories))].sort((a, b) =>
      a.localeCompare(b),
    );
    const values = (dimension: Dimension) => (row: ContextDocumentRow) => valuesOf(row, dimension);
    return facetDimensions<ContextDocumentRow>({
      rows: rowsAll,
      selected,
      matches: matchesQuery,
      dimensions: [
        {
          key: 'area',
          label: DIMENSION_WORD.area,
          valuesOf: values('area'),
          values: areas.map((area) => ({ value: area, label: area })),
        },
        {
          key: 'status',
          label: DIMENSION_WORD.status,
          valuesOf: values('status'),
          values: CONTEXT_DOCUMENT_STATUS_ORDER.map((status: ContextDocumentStatus) => ({
            value: status,
            label: CONTEXT_DOCUMENT_STATUS_WORD[status],
          })),
          hideEmpty: true,
        },
        {
          key: 'inclusion',
          label: DIMENSION_WORD.inclusion,
          valuesOf: values('inclusion'),
          values: CONTEXT_INCLUSION_ORDER.map((inclusion: ContextDocumentInclusion) => ({
            value: inclusion,
            label: CONTEXT_INCLUSION_WORD[inclusion],
          })),
        },
        {
          key: 'source',
          label: DIMENSION_WORD.source,
          valuesOf: values('source'),
          values: (sources ?? []).map((source) => ({ value: source.id, label: source.title })),
        },
        {
          key: 'repo',
          label: DIMENSION_WORD.repo,
          valuesOf: values('repo'),
          values: repositories.map((repo) => ({ value: repo, label: repo })),
        },
      ],
    });
  }, [rowsAll, matchesQuery, selected, sources]);

  const rows = useMemo(
    () => rowsAll.filter((row) => matchesQuery(row) && keeps(row, selected)),
    [rowsAll, matchesQuery, selected],
  );

  const tally = useMemo(
    () => tallyOf(rows, CONTEXT_ROW_WORD_ORDER, contextRowWordKey, contextRowWord),
    [rows],
  );

  const onlySource = useMemo(() => {
    const picked = selectedValues(selected, 'source');
    return picked.length === 1 ? (sources ?? []).find((s) => s.id === picked[0]) : undefined;
  }, [selected, sources]);

  const empty =
    documents === null
      ? 'Loading…'
      : error
        ? `The documents could not be read: ${error}`
        : rowsAll.length === 0
          ? 'No document yet. Add context, then scan.'
          : 'No document matches.';

  return (
    <ContextFrame
      section="documents"
      signal={signal}
      crumbs={
        onlySource
          ? [
              { label: 'Sources', to: CONTEXT_BASE },
              { label: onlySource.title, to: sourceHref(onlySource.id) },
              { label: 'Documents' },
            ]
          : [{ label: 'Documents' }]
      }
      {...(onlySource ? { right: <SourceHeader source={onlySource} /> } : {})}
    >
      <IndexTable<ContextDocumentRow>
        label="Documents"
        rows={rows}
        rowId={(row) => row.ref}
        onOpen={(row) => navigate(docHref(row.ref))}
        query={query}
        onQuery={setQuery}
        searchPlaceholder="Search documents"
        dimensions={dimensions}
        selected={selected}
        onSelect={select}
        filterAriaLabel="Filter documents"
        tally={tally}
        total={rowsAll.length}
        empty={empty}
        columns={[
          {
            key: 'title',
            label: 'Document',
            cell: (row) => (
              <>
                <span className="text-foreground">{row.title}</span>
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">{docPathOf(row.ref)}</span>
              </>
            ),
          },
          { key: 'area', label: 'Area', width: '10rem', className: 'text-muted-foreground', cell: (row) => row.area },
          {
            key: 'source',
            label: 'Source',
            width: '10rem',
            className: 'text-muted-foreground',
            cell: (row) => row.sourceTitle,
          },
          {
            key: 'repos',
            label: 'Repositories',
            width: '10rem',
            className: 'font-mono text-[12px] text-muted-foreground',
            cell: repositoriesLabel,
          },
          {
            key: 'status',
            label: 'Status',
            width: '7.5rem',
            cell: (row) => {
              const { word, tone } = contextRowWord(contextRowWordKey(row));
              const fact = contextRowFact(row);
              const status = <StatusWord tone={tone} word={word} />;
              // The word is the row; why the scan left a document out, or what
              // the next one will do with it, is a sentence and belongs on the
              // document's own page. It rides the word on hover so the list
              // stays one line per document.
                            // Narrow and right-aligned: the column sits at the table's edge,
              // so the surface wraps and hangs inward instead of off screen.
              return fact ? (
                <HoverPopover portal width="narrow" align="end" content={fact}>
                  {status}
                </HoverPopover>
              ) : (
                status
              );
            },
          },
          {
            key: 'updated',
            label: 'Updated',
            width: '6rem',
            className: 'text-muted-foreground',
            cell: (row) => (row.updatedAt ? formatRelativeTime(row.updatedAt) : ''),
          },
        ]}
      />
    </ContextFrame>
  );
}
