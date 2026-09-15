/**
 * Notifications: the workspace's durable feed, as the server stores it. Every
 * background job holds one row, which moves from started to how it settled, and
 * this is that store read back, newest first.
 *
 * The index is the platform's index shape (search full width, ONE filter row of
 * Add filter, dimension, value, then a one-line table). Read, Status and About
 * live in the address (`?read=&status=&about=`), so a narrowed feed is a place.
 * About is the subject of the row: the repository a repository job ran on, the
 * source a sync refreshed, nothing for the workspace's own Document scan. An
 * unread row carries its title in the foreground weight and a read one muted;
 * there is no dot and no second line.
 *
 * Opening a row marks it read and goes where the event happened: the run's own
 * conversation, the repository's run page, the source's page. A row whose event
 * named no address stays put.
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { NotificationLevel, NotificationView } from '@truecourse/shared';
import { PageHeader } from '@/dashboard/ui/bits';
import { filterKey, selectedValues, type FilterDimension } from '@/dashboard/ui/filter-builder';
import { facetDimensions } from '@/dashboard/ui/filter-facets';
import { IndexTable, type IndexColumn } from '@/dashboard/ui/index-table';
import { StatusWord, tallyOf } from '@/dashboard/ui/status-word';
import { useDashboardState } from '@/dashboard/shell/dashboard-state';
import { relativeTime } from '@/dashboard/shell/real-runs';
import {
  LEVEL_STATUS,
  notificationHref,
  notificationSubject,
} from '@/dashboard/shell/use-notifications';

const LEVELS = Object.keys(LEVEL_STATUS) as NotificationLevel[];

/** The filter dimensions, in the order the Add filter menu offers them. */
const DIMENSION_KEYS = ['read', 'status', 'about'] as const;
type DimensionKey = (typeof DIMENSION_KEYS)[number];

/** The URL parameter each dimension is spelled with. */
const PARAM: Record<DimensionKey, string> = { read: 'read', status: 'status', about: 'about' };

const readValue = (n: NotificationView): string => (n.readAt === null ? 'unread' : 'read');

export default function NotificationsPage() {
  const { notifications, unreadCount, markRead, markAllRead, repos } = useDashboardState();
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

  const matchesQuery = useCallback(
    (n: NotificationView) => {
      const q = query.trim().toLowerCase();
      return (
        q === '' || n.title.toLowerCase().includes(q) || (n.body?.toLowerCase().includes(q) ?? false)
      );
    },
    [query],
  );

  const rows = useMemo(() => {
    const reads = selectedValues(selected, 'read');
    const levels = selectedValues(selected, 'status');
    const subjects = selectedValues(selected, 'about');
    return notifications.filter(
      (n) =>
        (reads.length === 0 || reads.includes(readValue(n))) &&
        (levels.length === 0 || levels.includes(n.level)) &&
        (subjects.length === 0 || subjects.includes(notificationSubject(n) ?? '')) &&
        matchesQuery(n),
    );
  }, [notifications, matchesQuery, selected]);

  const tally = useMemo(
    () => tallyOf(rows, LEVELS, (n) => n.level, (level) => LEVEL_STATUS[level]),
    [rows],
  );

  const dimensions = useMemo<FilterDimension[]>(() => {
    const subjects = [
      ...new Set(notifications.map(notificationSubject).filter((s): s is string => s !== null)),
    ].sort();
    return facetDimensions<NotificationView>({
      rows: notifications,
      selected,
      matches: matchesQuery,
      dimensions: [
        {
          key: 'read',
          label: 'Read',
          valuesOf: (n) => [readValue(n)],
          values: [
            { value: 'unread', label: 'Unread' },
            { value: 'read', label: 'Read' },
          ],
        },
        {
          key: 'status',
          label: 'Status',
          valuesOf: (n) => [n.level],
          values: LEVELS.map((level) => ({ value: level, label: LEVEL_STATUS[level].word })),
          hideEmpty: true,
        },
        {
          key: 'about',
          label: 'About',
          valuesOf: (n) => {
            const subject = notificationSubject(n);
            return subject === null ? [] : [subject];
          },
          values: subjects.map((subject) => ({ value: subject, label: subject })),
        },
      ],
    });
  }, [notifications, matchesQuery, selected]);

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
        key: 'about',
        label: 'About',
        width: '14rem',
        className: 'font-mono text-[12px] text-muted-foreground',
        cell: (n) => notificationSubject(n) ?? '',
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
          tally={tally}
          total={notifications.length}
          empty={narrowed ? 'Nothing matches.' : 'Nothing has happened yet.'}
        />
      </div>
    </div>
  );
}
