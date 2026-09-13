/**
 * The workspace's notification feed, as the server stores it.
 *
 * Every background job holds ONE row that moves as it goes, and the store is
 * the whole feed: this reads it once on mount and takes each `notification`
 * frame the page's shared SSE stream delivers to the top of the list, replacing
 * the row of the same id, so a job lands on whatever page the reader is on.
 * Read state is the server's too, marked optimistically here and posted
 * straight after, so the badge answers the click rather than the round trip.
 *
 * Degrades to nothing. With no server to ask (a static page, a jsdom test) the
 * read fails quietly, the feed is empty, and a runtime without `EventSource`
 * opens none.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NotificationLevel, NotificationView } from '@truecourse/shared';
import { listNotifications, markNotificationsRead } from '@/lib/api';
import type { StatusTone } from '@/preview/ui/status-word';
import type { Repo } from '@/preview/data/types';
import { PREVIEW_BASE } from './base';
import { subscribeToServerEvents } from './event-stream';

/** A level as the status idiom says it: one word, one tone. */
export const LEVEL_STATUS: Record<NotificationLevel, { word: string; tone: StatusTone }> = {
  started: { word: 'Started', tone: 'running' },
  success: { word: 'Done', tone: 'success' },
  warning: { word: 'Needs you', tone: 'blocked' },
  error: { word: 'Failed', tone: 'failure' },
  info: { word: 'Note', tone: 'neutral' },
};

/** A string field of the event's payload, or null when it carries none. */
function text(data: Record<string, unknown> | null, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * What a notification is about, as the feed's column shows it: the repository
 * for a repository job, the source for a sync, and nothing for the workspace's
 * own Document scan, which reads every source there is.
 */
export const notificationSubject = (n: NotificationView): string | null =>
  text(n.data, 'repoFullName') ?? text(n.data, 'sourceTitle');

/**
 * Where a notification opens: the place the event happened. A setup, a
 * generation and a scan open their run's own conversation, a flow run opens
 * that run on the repository's Runs page (the runs themselves while it is
 * still going), and a sync opens the source it refreshed. A row whose payload
 * names none of those has no address.
 */
export function notificationHref(n: NotificationView, repos: readonly Repo[]): string | null {
  const runId = text(n.data, 'runId');
  const repo = repos.find((r) => r.fullName === text(n.data, 'repoFullName'));
  switch (n.kind) {
    case 'repo.guard-setup':
    case 'repo.guard-generate':
    case 'context.scan':
      return runId ? `${PREVIEW_BASE}/agent/${encodeURIComponent(runId)}` : null;
    case 'repo.guard-run': {
      const guardRunId = text(n.data, 'guardRunId');
      if (!repo) return null;
      return guardRunId
        ? `${PREVIEW_BASE}/repos/${repo.id}/runs/${encodeURIComponent(guardRunId)}`
        : `${PREVIEW_BASE}/repos/${repo.id}/runs`;
    }
    case 'context.sync': {
      const sourceId = text(n.data, 'sourceId');
      return sourceId
        ? `${PREVIEW_BASE}/context/sources/${encodeURIComponent(sourceId)}`
        : null;
    }
    default:
      return null;
  }
}

export interface NotificationFeed {
  /** The stored rows, newest first. Empty until the first read lands. */
  notifications: NotificationView[];
  /** The first read has settled, so what `notifications` holds is history. */
  ready: boolean;
  unreadCount: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

export function useNotifications(): NotificationFeed {
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [ready, setReady] = useState(false);
  const alive = useRef(true);
  // What the feed holds right now, for the two marks: they are called from a
  // row's click and must decide on the current list, not on a captured one.
  const current = useRef<NotificationView[]>(notifications);
  current.current = notifications;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const { notifications: stored } = await listNotifications();
        if (alive.current) setNotifications(stored);
      } catch {
        // No server, or a workspace it will not answer for: nothing to show.
      } finally {
        if (alive.current) setReady(true);
      }
    })();
  }, []);

  useEffect(
    () =>
      subscribeToServerEvents((event) => {
        if (event.type !== 'notification' || !event.notification) return;
        const landed = event.notification;
        // A job's row moves rather than repeats: the settle frame carries the id
        // the started frame did, so it replaces that row at the top of the feed.
        setNotifications((prev) => [landed, ...prev.filter((n) => n.id !== landed.id)]);
      }),
    [],
  );

  const markRead = useCallback((id: string) => {
    const row = current.current.find((n) => n.id === id);
    if (!row || row.readAt !== null) return;
    const at = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, readAt: at } : n)));
    // The row reads as read here whatever the post does; the store settles it
    // on the next read.
    void markNotificationsRead({ ids: [id] }).catch(() => {});
  }, []);

  const markAllRead = useCallback(() => {
    if (!current.current.some((n) => n.readAt === null)) return;
    const at = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt: at })));
    void markNotificationsRead({ all: true }).catch(() => {});
  }, []);

  return useMemo(
    () => ({
      notifications,
      ready,
      unreadCount: notifications.filter((n) => n.readAt === null).length,
      markRead,
      markAllRead,
    }),
    [notifications, ready, markRead, markAllRead],
  );
}
