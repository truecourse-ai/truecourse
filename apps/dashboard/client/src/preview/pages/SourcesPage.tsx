// PREVIEW: REAL. Every source of the workspace's context, from the server.

/**
 * Context › Sources: ONE table, one row per source the workspace has, worst
 * first (failed, never synced, syncing, paused, synced), then by title. A
 * source is where documents come from, so the section LANDS here, on the
 * origins: what each one is, which repositories read it, how many documents it
 * yielded and when it last synced. Every word is the server's — the title, the
 * repositories and the counts are `GET /api/context/sources`, the state is a
 * status word, and a failure carries the source's own `statusNote` verbatim.
 *
 * A source's ACTIONS live here too, one menu per row: Sync now, Pause / Resume
 * and — for a site — Remove, which names the repositories that read it before
 * it goes. A repository source is removed by disconnecting the repository, so
 * it is not offered here. The menu is the row's own affordance: opening it does
 * not open the row, and the row still opens on a single click.
 *
 * A source is not a page of its own: a row opens the Documents view narrowed to
 * it (`/preview/context/documents?source=<id>`).
 *
 * There is nothing to narrow a source list along that the search does not
 * already do, so this list has no filter row.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import { toast } from 'sonner';
import {
  CONTEXT_SOURCE_KIND_LABEL,
  CONTEXT_SOURCE_STATUS_ORDER,
  type ContextSourceView,
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
import { CONTEXT_SYNC_TONE, CONTEXT_SYNC_WORD, StatusWord } from '@/preview/ui/status-word';
import { formatRelativeTime } from '@/preview/vendor/shared/format/relative-time';
import { useContextSignal, useContextSources } from '@/preview/shell/use-context';
import { ContextFrame } from './ContextFrame';
import { documentsHref } from './context-hrefs';

const MENU_ITEM =
  'flex w-full items-center px-3 py-2 text-left text-xs text-foreground hover:bg-muted/60 disabled:opacity-50 disabled:hover:bg-transparent';

const severity = (source: ContextSourceView): number =>
  CONTEXT_SOURCE_STATUS_ORDER.indexOf(source.status);

/** What a row says under Repositories: the one that reads it, or how many do. */
function repositoriesLabel(source: ContextSourceView): string {
  if (source.repositories.length === 0) return '—';
  if (source.repositories.length === 1) return source.repositories[0]!;
  return `${source.repositories.length} repositories`;
}

/**
 * One row's menu: what can be done to that source. Every click inside it is
 * stopped before the row sees it — the row's job is to open the source's
 * documents, and an action is not a navigation.
 */
function SourceMenu({ source, onChanged }: { source: ContextSourceView; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const readers = source.repositories;

  // Closes on a click anywhere outside, and on Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

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
    <span
      ref={ref}
      className="relative flex justify-end"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      role="presentation"
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${source.title}`}
        onClick={() => setOpen((v) => !v)}
        className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      >
        <MoreVertical className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <span
          role="menu"
          aria-label={`Actions for ${source.title}`}
          className="absolute right-0 top-full z-50 mt-1 flex w-44 flex-col overflow-hidden rounded-md border border-border bg-popover py-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            disabled={busy || source.status === 'syncing' || source.status === 'paused'}
            onClick={() =>
              void act(() => syncContextSource(source.id)).finally(() => setOpen(false))
            }
            className={MENU_ITEM}
          >
            Sync now
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={busy}
            onClick={() =>
              void act(() =>
                pauseContextSource(source.id, source.status !== 'paused'),
              ).finally(() => setOpen(false))
            }
            className={MENU_ITEM}
          >
            {source.status === 'paused' ? 'Resume' : 'Pause'}
          </button>
          {source.kind === 'site' && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                setRemoving(true);
              }}
              className={`${MENU_ITEM} text-destructive hover:bg-destructive/10`}
            >
              Remove
            </button>
          )}
        </span>
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
            <button
              type="button"
              onClick={() => setRemoving(false)}
              className="rounded border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
            >
              Keep it
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await removeContextSource(source.id);
                  setRemoving(false);
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

export default function SourcesPage() {
  const navigate = useNavigate();
  const signal = useContextSignal();
  const { sources, error, refetch } = useContextSources(signal);
  const [query, setQuery] = useState('');

  const reread = useCallback(() => {
    void refetch();
  }, [refetch]);

  const all = useMemo(
    () =>
      [...(sources ?? [])].sort(
        (a, b) => severity(a) - severity(b) || a.title.localeCompare(b.title),
      ),
    [sources],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q === '' ? all : all.filter((source) => source.title.toLowerCase().includes(q));
  }, [all, query]);

  const empty =
    sources === null
      ? 'Loading…'
      : error
        ? `The sources could not be read: ${error}`
        : all.length === 0
          ? 'No source yet. Add context to connect one.'
          : 'No source matches.';

  return (
    <ContextFrame section="sources" signal={signal}>
      <IndexTable<ContextSourceView>
        label="Sources"
        rows={rows}
        rowId={(source) => source.id}
        onOpen={(source) => navigate(documentsHref({ source: source.id }))}
        query={query}
        onQuery={setQuery}
        searchPlaceholder="Search sources"
        empty={empty}
        columns={[
          {
            key: 'title',
            label: 'Source',
            cell: (source) => <span className="text-foreground">{source.title}</span>,
          },
          {
            key: 'kind',
            label: 'Kind',
            className: 'text-muted-foreground',
            cell: (source) => CONTEXT_SOURCE_KIND_LABEL[source.kind],
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
            cell: (source) => (
              <span className="flex min-w-0 flex-col gap-0.5">
                <StatusWord
                  tone={CONTEXT_SYNC_TONE[source.status]}
                  word={CONTEXT_SYNC_WORD[source.status]}
                />
                {/* A failure says why, in the source's own words — as the agent's
                    conversation says why a run stopped. */}
                {source.status === 'failed' && source.statusNote && (
                  <span className="break-words text-[11px] leading-snug text-red-600 dark:text-red-400">
                    {source.statusNote}
                  </span>
                )}
              </span>
            ),
          },
          {
            key: 'documents',
            label: 'Documents',
            className: 'tabular-nums text-muted-foreground',
            cell: (source) => source.docCount,
          },
          {
            key: 'lastSync',
            label: 'Last sync',
            className: 'text-muted-foreground',
            cell: (source) => (source.lastSyncAt ? formatRelativeTime(source.lastSyncAt) : '—'),
          },
          {
            key: 'actions',
            label: '',
            className: 'w-10',
            cell: (source) => <SourceMenu source={source} onChanged={reread} />,
          },
        ]}
      />
    </ContextFrame>
  );
}
