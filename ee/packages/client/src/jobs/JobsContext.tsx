/**
 * App-wide live jobs + notifications state for the enterprise console.
 *
 * Mounted ONCE high in the tree (via the EeClientModule `shell.provider` seam),
 * so the single SSE connection survives route changes. Seeds from the REST
 * endpoints on mount, then keeps itself live off `GET /api/ee/events`:
 *   - `job.progress` → upsert `activeJobs` + a live (loading) toast keyed by job
 *   - `notification` → prepend to the feed, bump unread, resolve the toast, and
 *      drop the now-terminal job from `activeJobs`
 *
 * On every (re)connect it re-fetches active jobs + unread, so events missed while
 * disconnected are reconciled (NOTIFY isn't durable; the tables are the truth).
 *
 * `activeJobFor(type, key)` is what drives a server-derived "Syncing…" button
 * that survives a page refresh (the active job is re-read from the server, not
 * local component state).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';
import {
  isActiveJob,
  type JobView,
  type NotificationView,
  type ServerEvent,
} from '@truecourse/shared';
import { getJson, postJson, serverUrl } from '../api';
import { JobProgressPopup } from './JobProgressPopup';

interface JobsContextValue {
  notifications: NotificationView[];
  unreadCount: number;
  activeJobs: JobView[];
  /** The active job holding (type, key), if any — e.g. ('knowledge.sync', 'knowledge.sync:confluence'). */
  activeJobFor: (type: string, key: string) => JobView | undefined;
  markAllRead: () => Promise<void>;
  markRead: (ids: string[]) => Promise<void>;
  refresh: () => Promise<void>;
}

const noop = async () => {};
const JobsContext = createContext<JobsContextValue>({
  notifications: [],
  unreadCount: 0,
  activeJobs: [],
  activeJobFor: () => undefined,
  markAllRead: noop,
  markRead: noop,
  refresh: noop,
});

export function useJobs(): JobsContextValue {
  return useContext(JobsContext);
}

export default function JobsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<NotificationView[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [activeJobs, setActiveJobs] = useState<JobView[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [jobsRes, notifRes] = await Promise.all([
        getJson<{ jobs: JobView[] }>('/api/ee/jobs?active=1'),
        getJson<{ notifications: NotificationView[]; unreadCount: number }>('/api/ee/notifications'),
      ]);
      setActiveJobs(jobsRes.jobs);
      setNotifications(notifRes.notifications);
      setUnreadCount(notifRes.unreadCount);
    } catch {
      // Non-fatal: the SSE stream (and a later refresh) will reconcile.
    }
  }, []);

  const handleEvent = useCallback((ev: ServerEvent) => {
    if (ev.type === 'job.progress') {
      // Live progress drives the bottom-center popup (via activeJobs), mirroring
      // the OSS analyze popup. A terminal job.progress (succeeded/failed) drops
      // the job from the set, so its card disappears on its own.
      const job = ev.job;
      setActiveJobs((prev) => {
        const rest = prev.filter((j) => j.id !== job.id);
        return isActiveJob(job.status) ? [job, ...rest] : rest;
      });
    } else if (ev.type === 'notification') {
      const n = ev.notification;
      setNotifications((prev) => [n, ...prev]);
      setUnreadCount((c) => c + 1);
      // Clear the now-terminal job from activeJobs (its popup card vanishes) and
      // surface the durable outcome as a toast. Quiet jobs (contract refresh)
      // send no notification — their card just disappears on the terminal event.
      if (ev.jobId) setActiveJobs((prev) => prev.filter((j) => j.id !== ev.jobId));
      const opts = { description: n.body ?? undefined, duration: 10000 };
      if (n.level === 'error') toast.error(n.title, opts);
      else if (n.level === 'success') toast.success(n.title, opts);
      else if (n.level === 'warning') toast.warning(n.title, opts);
      else toast.info(n.title, opts);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const es = new EventSource(`${serverUrl()}/api/ee/events`, { withCredentials: true });
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        handleEvent(JSON.parse(e.data) as ServerEvent);
      } catch {
        // ignore malformed frames / heartbeat comments
      }
    };
    // EventSource auto-reconnects; reconcile any events missed while down.
    es.onopen = () => void refresh();
    return () => {
      es.close();
      esRef.current = null;
    };
  }, [refresh, handleEvent]);

  const activeJobFor = useCallback(
    (type: string, key: string) => activeJobs.find((j) => j.type === type && j.key === key),
    [activeJobs],
  );

  const markRead = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return;
    const { unreadCount: count } = await postJson<{ unreadCount: number }>(
      '/api/ee/notifications/read',
      { ids },
    );
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, readAt: n.readAt ?? now } : n)));
    setUnreadCount(count);
  }, []);

  const markAllRead = useCallback(async () => {
    const { unreadCount: count } = await postJson<{ unreadCount: number }>(
      '/api/ee/notifications/read',
      { all: true },
    );
    const now = new Date().toISOString();
    setNotifications((prev) => prev.map((n) => ({ ...n, readAt: n.readAt ?? now })));
    setUnreadCount(count);
  }, []);

  return (
    <JobsContext.Provider
      value={{ notifications, unreadCount, activeJobs, activeJobFor, markAllRead, markRead, refresh }}
    >
      {children}
      <JobProgressPopup jobs={activeJobs} />
    </JobsContext.Provider>
  );
}
