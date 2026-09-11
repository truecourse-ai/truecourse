/**
 * Notifications: the workspace's durable feed, as the server stores it. Every
 * background job posts one row when it settles, and this is that store read
 * back, newest first.
 *
 * The index is the platform's index shape (search full width, ONE filter row of
 * Add filter, dimension, value, then a one-line table). Read, Status and
 * Repository live in the address (`?read=&status=&repo=`), so a narrowed feed is
 * a place. An unread row carries its title in the foreground weight and a read
 * one muted; there is no dot and no second line.
 *
 * Opening a row marks it read and goes where the event happened: the run's own
 * conversation, the repository's run page, the source's page. A row whose event
 * named no address stays put.
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { NotificationLevel, NotificationView } from '@truecourse/shared';
import { PageHeader } from '@/preview/ui/bits';
import { filterKey, selectedValues, type FilterDimension } from '@/preview/ui/filter-builder';
import { IndexTable, type IndexColumn } from '@/preview/ui/index-table';
import { StatusWord } from '@/preview/ui/status-word';
import { usePreviewState } from '@/preview/shell/preview-state';
import { relativeTime } from '@/preview/shell/real-runs';
import {
  LEVEL_STATUS,
  notificationHref,
  notificationRepo,
} from '@/preview/shell/use-notifications';

const LEVELS = Object.keys(LEVEL_STATUS) as NotificationLevel[];

/** The filter dimensions, in the order the Add filter menu offers them. */
const DIMENSION_KEYS = ['read', 'status', 'repo'] as const;
type DimensionKey = (typeof DIMENSION_KEYS)[number];

/** The URL parameter each dimension is spelled with. */
const PARAM: Record<DimensionKey, string> = { read: 'read', status: 'status', repo: 'repo' };

const readValue = (n: NotificationView): string => (n.readAt === null ? 'unread' : 'read');

export default function NotificationsPage() {
  const { notifications, unreadCount, markRead, markAllRead, repos } = usePreviewState();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');

  const selected = useMemo(
    () =>
      DIMENSION_KEYS.flatMap((d) => params.getAll(PARAM[d]).map((value) => filterKey(d, value))),
    [params],
  );

  const onSelect = useCallback(
    (next: string[]) => {
      const grouped = new URLSearchParams();
      for (const d of DIMENSION_KEYS) {
        for (const value of selectedValues(next, d)) grouped.append(PARAM[d], value);
      }
      setParams(grouped, { replace: true });
    },
    [setParams],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const reads = selectedValues(selected, 'read');
    const levels = selectedValues(selected, 'status');
    const pickedRepos = selectedValues(selected, 'repo');
    return notifications.filter(
      (n) =>
        (reads.length === 0 || reads.includes(readValue(n))) &&
        (levels.length === 0 || levels.includes(n.level)) &&
        (pickedRepos.length === 0 || pickedRepos.includes(notificationRepo(n) ?? '')) &&
        (q === '' ||
          n.title.toLowerCase().includes(q) ||
          (n.body?.toLowerCase().includes(q) ?? false)),
    );
  }, [notifications, query, selected]);

  const dimensions = useMemo<FilterDimension[]>(() => {
    const named = [...new Set(notifications.map(notificationRepo).filter((r): r is string => r !== null))].sort();
    return [
      {
        key: 'read',
        label: 'Read',
        options: [
          { key: filterKey('read', 'unread'), label: 'Unread', count: unreadCount },
          {
            key: filterKey('read', 'read'),
            label: 'Read',
            count: notifications.length - unreadCount,
          },
        ],
      },
      {
        key: 'status',
        label: 'Status',
        options: LEVELS.map((level) => ({
          key: filterKey('status', level),
          label: LEVEL_STATUS[level].word,
          count: notifications.filter((n) => n.level === level).length,
        })).filter((o) => o.count > 0),
      },
      {
        key: 'repo',
        label: 'Repository',
        options: named.map((fullName) => ({
          key: filterKey('repo', fullName),
          label: fullName,
          count: notifications.filter((n) => notificationRepo(n) === fullName).length,
        })),
      },
    ];
  }, [notifications, unreadCount]);

  const columns = useMemo<IndexColumn<NotificationView>[]>(
    () => [
      {
        key: 'notification',
        label: 'Notification',
        cell: (n) => (
          <>
            <span
              className={n.readAt === null ? 'font-medium text-foreground' : 'text-muted-foreground'}
            >
              {n.title}
            </span>
            {n.body && <span className="ml-2 text-muted-foreground">{n.body}</span>}
          </>
        ),
      },
      {
        key: 'repository',
        label: 'Repository',
        width: '14rem',
        className: 'font-mono text-[12px] text-muted-foreground',
        cell: (n) => notificationRepo(n) ?? '',
      },
      {
        key: 'status',
        label: 'Status',
        width: '8rem',
        cell: (n) => (
          <StatusWord tone={LEVEL_STATUS[n.level].tone} word={LEVEL_STATUS[n.level].word} />
        ),
      },
      {
        key: 'when',
        label: 'When',
        width: '7rem',
        className: 'text-muted-foreground',
        cell: (n) => relativeTime(n.createdAt),
      },
    ],
    [],
  );

  const narrowed = query.trim() !== '' || selected.length > 0;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title="Notifications"
        right={
          unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="rounded border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/60"
            >
              Mark all read
            </button>
          )
        }
      />
      <div className="min-h-0 flex-1">
        <IndexTable
          label="Workspace notifications"
          rows={rows}
          rowId={(n) => n.id}
          columns={columns}
          onOpen={(n) => {
            markRead(n.id);
            const href = notificationHref(n, repos);
            if (href) navigate(href);
          }}
          query={query}
          onQuery={setQuery}
          searchPlaceholder="Search notifications"
          dimensions={dimensions}
          selected={selected}
          onSelect={onSelect}
          filterAriaLabel="Filter notifications"
          empty={narrowed ? 'Nothing matches.' : 'Nothing has happened yet.'}
        />
      </div>
    </div>
  );
}
