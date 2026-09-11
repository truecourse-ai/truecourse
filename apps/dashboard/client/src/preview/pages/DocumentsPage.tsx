// PREVIEW: REAL. Every document of the workspace's context, from the server.

/**
 * Context IS the documents: ONE table, one row per document of the workspace
 * corpus, worst first. A source is a filter over it, a repository is a reading
 * of it, and the status a row wears is the server's fold across every
 * repository that reads the document (`GET /api/context/documents`) — nothing
 * here computes a status, and nothing here writes a word the server did not.
 *
 * ONE filter row narrows it along four dimensions — Area, Status, Source and
 * Repository — and every narrowing rides the address (`?area=`, `?status=`,
 * `?source=`, `?repo=`), so a narrowed page is a place: the repository's
 * Context tab links straight to `?source=<id>`.
 *
 * Narrowed to exactly ONE source, the header becomes that source's: its sync
 * status, and its actions (Sync now, Pause / Resume, Remove for a site; the
 * patterns and the branch for a repository source).
 *
 * The page actions are the workspace's own: Scan (the Document scan, dotted
 * while the context has moved since the corpus) and Add context. The scan
 * starts HERE and nowhere else.
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  CONTEXT_DOCUMENT_STATUS_ORDER,
  CONTEXT_DOCUMENT_STATUS_WORD,
  type ContextDocumentRow,
  type ContextDocumentStatus,
  type ContextSourceView,
  type RepositorySourceConfig,
} from '@truecourse/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { pauseContextSource, removeContextSource, syncContextSource } from '@/lib/api';
import { IndexTable } from '@/preview/ui/index-table';
import {
  filterKey,
  parseFilterKey,
  selectedValues,
  type FilterDimension,
} from '@/preview/ui/filter-builder';
import {
  CONTEXT_DOC_TONE,
  CONTEXT_SYNC_TONE,
  CONTEXT_SYNC_WORD,
  StatusWord,
} from '@/preview/ui/status-word';
import { formatRelativeTime } from '@/preview/vendor/shared/format/relative-time';
import { startContextScan } from '@/preview/data/scan';
import { toastNoLlmProvider } from '@/preview/shell/use-run-trigger';
import { useWorkspaceRuns } from '@/preview/shell/use-workspace-runs';
import {
  useContextDocuments,
  useContextSignal,
  useContextSources,
  useContextStaleness,
} from '@/preview/shell/use-context';
import { AddContextDialog } from './AddContextDialog';
import { ContextFrame } from './ContextFrame';
import { CONTEXT_BASE, docHref } from './context-hrefs';

const ACTION =
  'rounded border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60 disabled:opacity-50';

/** The dimensions the one filter row narrows along, each its own address parameter. */
const DIMENSIONS = ['area', 'status', 'source', 'repo'] as const;
type Dimension = (typeof DIMENSIONS)[number];
const DIMENSION_WORD: Record<Dimension, string> = {
  area: 'Area',
  status: 'Status',
  source: 'Source',
  repo: 'Repository',
};
const isDimension = (key: string): key is Dimension =>
  (DIMENSIONS as readonly string[]).includes(key);

/** The values a row has along one dimension (a document may read in several repositories). */
function valuesOf(row: ContextDocumentRow, dimension: Dimension): string[] {
  switch (dimension) {
    case 'area':
      return [row.area];
    case 'status':
      return [row.status];
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

/** A repository source's scope, in its own words: the patterns and the branch. */
function RepositoryScope({ source }: { source: ContextSourceView }) {
  const config = source.config as Partial<RepositorySourceConfig>;
  const patterns = [
    ...(config.include ?? []),
    ...(config.exclude ?? []).map((glob) => `!${glob}`),
  ];
  return (
    <span className="flex items-center gap-3 text-[11px] text-muted-foreground">
      <span className="font-mono">{config.branch || 'the default branch'}</span>
      {patterns.length > 0 && <span className="font-mono">{patterns.join(' ')}</span>}
    </span>
  );
}

/** The one source the view is narrowed to: its status, and what can be done to it. */
function SourceActions({ source, onChanged }: { source: ContextSourceView; onChanged: () => void }) {
  const navigate = useNavigate();
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const readers = source.repositories;

  const act = async (run: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    try {
      await run();
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="flex shrink-0 items-center gap-3">
      {source.kind === 'repository' && <RepositoryScope source={source} />}
      <StatusWord tone={CONTEXT_SYNC_TONE[source.status]} word={CONTEXT_SYNC_WORD[source.status]} />
      {source.kind === 'site' && (
        <>
          <button
            type="button"
            onClick={() => void act(() => syncContextSource(source.id))}
            disabled={busy || source.status === 'syncing' || source.status === 'paused'}
            className={ACTION}
          >
            Sync now
          </button>
          <button
            type="button"
            onClick={() => void act(() => pauseContextSource(source.id, source.status !== 'paused'))}
            disabled={busy}
            className={ACTION}
          >
            {source.status === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button
            type="button"
            onClick={() => setRemoving(true)}
            className="rounded border border-destructive/40 px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            Remove
          </button>
        </>
      )}
      <Dialog open={removing} onOpenChange={setRemoving}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Remove {source.title}?</DialogTitle>
            <DialogDescription>
              {readers.length > 0
                ? `${readers.join(', ')} ${readers.length === 1 ? 'reads' : 'read'} this source. Removing it re-scans the workspace without its documents.`
                : 'No repository reads this source; removing it changes no corpus.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" onClick={() => setRemoving(false)} className={ACTION}>
              Keep it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await removeContextSource(source.id);
                  setRemoving(false);
                  navigate(CONTEXT_BASE);
                })
              }
              className="rounded bg-destructive px-2.5 py-1.5 text-xs font-medium text-destructive-foreground hover:opacity-90 disabled:opacity-50"
            >
              Remove
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}

/**
 * The workspace Document scan. Amber-dotted while the context has moved since
 * the corpus was built; disabled and saying so while one is running, which is
 * read from the workspace's own runs, not guessed at.
 */
function ScanButton({ stale, scanning }: { stale: boolean; scanning: boolean }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const running = pending || scanning;

  const start = useCallback(() => {
    if (running) return;
    setPending(true);
    void startContextScan()
      .then((outcome) => {
        switch (outcome.kind) {
          case 'started':
            return;
          case 'not-configured':
            toastNoLlmProvider(navigate, outcome.message);
            return;
          case 'probe-failed':
            toast.error(`Provider check failed: ${outcome.message}`);
            return;
          case 'busy':
            toast.error('A document scan is already running');
            return;
          default:
            toast.error('Could not start the document scan', { description: outcome.message });
        }
      })
      .finally(() => setPending(false));
  }, [navigate, running]);

  return (
    <button type="button" onClick={start} disabled={running} className={`${ACTION} relative`}>
      {running ? 'Scanning…' : 'Scan'}
      {stale && !running && (
        <span
          aria-label="scan pending"
          className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-400 ring-2 ring-background"
        />
      )}
    </button>
  );
}

export default function DocumentsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const signal = useContextSignal();
  const { documents, error, refetch } = useContextDocuments(signal);
  const { sources, refetch: refetchSources } = useContextSources(signal);
  const stale = useContextStaleness(signal);
  const { runs } = useWorkspaceRuns([]);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');

  // A Document scan belongs to the workspace, so it is the run with no
  // repository — the one fact that says the button is busy.
  const scanning = (runs ?? []).some(
    (run) => run.repo === null && run.command === 'spec-scan' && run.status === 'running',
  );

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

  const dimensions = useMemo<FilterDimension[]>(() => {
    const count = (dimension: Dimension, value: string) =>
      rowsAll.filter((row) => valuesOf(row, dimension).includes(value)).length;
    const areas = [...new Set(rowsAll.map((row) => row.area))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
    const repositories = [...new Set(rowsAll.flatMap((row) => row.repositories))].sort((a, b) =>
      a.localeCompare(b),
    );
    const sourceOptions = (sources ?? []).map((source) => ({
      key: filterKey('source', source.id),
      label: source.title,
      count: count('source', source.id),
    }));
    return [
      {
        key: 'area',
        label: DIMENSION_WORD.area,
        options: areas.map((area) => ({
          key: filterKey('area', area),
          label: area,
          count: count('area', area),
        })),
      },
      {
        key: 'status',
        label: DIMENSION_WORD.status,
        options: CONTEXT_DOCUMENT_STATUS_ORDER.map((status: ContextDocumentStatus) => ({
          key: filterKey('status', status),
          label: CONTEXT_DOCUMENT_STATUS_WORD[status],
          count: count('status', status),
        })).filter((option) => option.count > 0),
      },
      { key: 'source', label: DIMENSION_WORD.source, options: sourceOptions },
      {
        key: 'repo',
        label: DIMENSION_WORD.repo,
        options: repositories.map((repo) => ({
          key: filterKey('repo', repo),
          label: repo,
          count: count('repo', repo),
        })),
      },
    ];
  }, [rowsAll, sources]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rowsAll.filter(
      (row) => (!q || row.title.toLowerCase().includes(q)) && keeps(row, selected),
    );
  }, [rowsAll, query, selected]);

  const onlySource = useMemo(() => {
    const picked = selectedValues(selected, 'source');
    return picked.length === 1 ? (sources ?? []).find((s) => s.id === picked[0]) : undefined;
  }, [selected, sources]);

  const reread = useCallback(() => {
    void refetch();
    void refetchSources();
  }, [refetch, refetchSources]);

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
      crumbs={onlySource ? [{ label: onlySource.title }] : []}
      right={
        <>
          {onlySource && <SourceActions source={onlySource} onChanged={reread} />}
          <ScanButton stale={stale} scanning={scanning} />
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            Add context
          </button>
        </>
      }
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
        empty={empty}
        columns={[
          {
            key: 'title',
            label: 'Document',
            cell: (row) => <span className="text-foreground">{row.title}</span>,
          },
          { key: 'area', label: 'Area', className: 'text-muted-foreground', cell: (row) => row.area },
          {
            key: 'source',
            label: 'Source',
            className: 'text-muted-foreground',
            cell: (row) => row.sourceTitle,
          },
          {
            key: 'repos',
            label: 'Repositories',
            className: 'font-mono text-[12px] text-muted-foreground',
            cell: repositoriesLabel,
          },
          {
            key: 'status',
            label: 'Status',
            cell: (row) => (
              <StatusWord
                tone={CONTEXT_DOC_TONE[row.status]}
                word={CONTEXT_DOCUMENT_STATUS_WORD[row.status]}
              />
            ),
          },
          {
            key: 'updated',
            label: 'Updated',
            className: 'text-muted-foreground',
            cell: (row) => (row.updatedAt ? formatRelativeTime(row.updatedAt) : ''),
          },
        ]}
      />
      <AddContextDialog
        open={adding}
        onOpenChange={setAdding}
        sources={sources}
        onAdded={reread}
      />
    </ContextFrame>
  );
}
