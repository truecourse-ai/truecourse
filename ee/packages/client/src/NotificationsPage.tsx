/**
 * The notifications feed (enterprise): the durable history of background-job
 * outcomes and other workspace events. Reads from the shared `useJobs()` store
 * (seeded from `GET /api/ee/notifications`, kept live by SSE). Rows show a level
 * icon, title, body and relative time; unread rows carry a dot. "Mark all read"
 * clears the bell badge.
 */

import { useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, BellOff } from 'lucide-react';
import type { NotificationLevel, NotificationView } from '@truecourse/shared';
import { useJobs } from './jobs/JobsContext';

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function LevelIcon({ level }: { level: NotificationLevel }) {
  if (level === 'success') return <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />;
  if (level === 'error') return <XCircle className="h-4 w-4 shrink-0 text-red-500" />;
  if (level === 'warning') return <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />;
  return <Info className="h-4 w-4 shrink-0 text-blue-500" />;
}

function Row({ n, onClick }: { n: NotificationView; onClick: () => void }) {
  const unread = n.readAt === null;
  const detail = typeof n.data?.detail === 'string' ? n.data.detail : null;
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div className={`px-4 py-3 transition-colors hover:bg-muted/40 ${unread ? 'bg-primary/[0.04]' : ''}`}>
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}
        className="flex w-full cursor-pointer items-start gap-3 text-left"
      >
        <LevelIcon level={n.level} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={`text-sm ${unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/90'}`}>
              {n.title}
            </span>
            {unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="unread" />}
          </div>
          {n.body && <p className="mt-0.5 break-words text-xs text-muted-foreground">{n.body}</p>}
        </div>
        <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
      </div>
      {detail && (
        <div className="ml-7 mt-1.5">
          <button
            type="button"
            onClick={() => setShowDetail((v) => !v)}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {showDetail ? 'Hide details' : 'Details'}
          </button>
          {showDetail && (
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-muted/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
              {detail}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  const { notifications, unreadCount, markRead, markAllRead } = useJobs();

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            Background syncs and workspace events. {unreadCount > 0 ? `${unreadCount} unread.` : 'All caught up.'}
          </p>
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="shrink-0 rounded border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted/40"
          >
            Mark all read
          </button>
        )}
      </header>

      <div className="overflow-hidden rounded border border-border">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-sm text-muted-foreground">
            <BellOff className="h-5 w-5" />
            <span>No notifications yet.</span>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {notifications.map((n) => (
              <Row key={n.id} n={n} onClick={() => n.readAt === null && void markRead([n.id])} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
