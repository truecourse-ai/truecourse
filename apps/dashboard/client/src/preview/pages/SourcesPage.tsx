/**
 * Context › Sources: ONE table, one row per source the workspace has, worst
 * first (failed, never synced, syncing, paused, synced), then by title. A
 * source is where documents come from, so the section LANDS here, on the
 * origins: what each one is, which repositories read it, how many documents it
 * yielded and when it last synced. Every word is the server's — the title, the
 * repositories and the counts are `GET /api/context/sources`, the state is a
 * status word, and a failure carries the source's own `statusNote` verbatim.
 *
 * A row does ONE thing: on a single click it opens the source's own page
 * (`/preview/context/sources/<id>`). What can be DONE to a source — Sync now,
 * Pause / Resume, Remove — is that page's header, and nowhere else.
 *
 * There is nothing to narrow a source list along that the search does not
 * already do, so this list has no filter row.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CONTEXT_SOURCE_KIND_LABEL,
  CONTEXT_SOURCE_STATUS_ORDER,
  type ContextSourceView,
} from '@truecourse/shared';
import { IndexTable } from '@/preview/ui/index-table';
import { CONTEXT_SYNC_TONE, CONTEXT_SYNC_WORD, StatusWord } from '@/preview/ui/status-word';
import { formatRelativeTime } from '@/preview/vendor/shared/format/relative-time';
import { useContextSignal, useContextSources } from '@/preview/shell/use-context';
import { ContextFrame } from './ContextFrame';
import { sourceHref } from './context-hrefs';

const severity = (source: ContextSourceView): number =>
  CONTEXT_SOURCE_STATUS_ORDER.indexOf(source.status);

/** What a row says under Repositories: the one that reads it, or how many do. */
function repositoriesLabel(source: ContextSourceView): string {
  if (source.repositories.length === 0) return '—';
  if (source.repositories.length === 1) return source.repositories[0]!;
  return `${source.repositories.length} repositories`;
}

export default function SourcesPage() {
  const navigate = useNavigate();
  const signal = useContextSignal();
  const { sources, error } = useContextSources(signal);
  const [query, setQuery] = useState('');

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
        onOpen={(source) => navigate(sourceHref(source.id))}
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
            width: '9rem',
            className: 'text-muted-foreground',
            cell: (source) => CONTEXT_SOURCE_KIND_LABEL[source.kind],
          },
          {
            key: 'repos',
            label: 'Repositories',
            width: '14rem',
            className: 'font-mono text-[12px] text-muted-foreground',
            cell: repositoriesLabel,
          },
          {
            key: 'status',
            label: 'Status',
            width: '8rem',
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
            width: '6rem',
            className: 'tabular-nums text-muted-foreground',
            cell: (source) => source.docCount,
          },
          {
            key: 'lastSync',
            label: 'Last sync',
            width: '7rem',
            className: 'text-muted-foreground',
            cell: (source) => (source.lastSyncAt ? formatRelativeTime(source.lastSyncAt) : '—'),
          },
        ]}
      />
    </ContextFrame>
  );
}
