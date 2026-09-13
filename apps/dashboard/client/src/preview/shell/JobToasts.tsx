/**
 * A job that starts while the page is open announces itself ONCE, as a toast
 * carrying a link to the run's own conversation. Jobs already in flight when
 * the page loads never announce. Nothing in the toast moves: no steps, no
 * counter, no bar. Progress lives in one place, the conversation, and the
 * toast only says where to look. Renders nothing itself.
 *
 * Every job here is a run: the toast carries that run's conversation address.
 *
 * A NOTIFICATION that lands while the page is open announces the same way,
 * once: the job's own words for what happened, in its level's colour, and the
 * way to where it happened when the row has an address. Rows already in the
 * feed when the page loaded are history, not news. Both announcements are
 * session-local sets: nothing is persisted, and a reload starts them over.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowUpRight, X } from 'lucide-react';
import type { NotificationLevel, NotificationView } from '@truecourse/shared';
import type { JobChain } from '@/preview/data/types';
import { usePreviewState } from './preview-state';
import { notificationHref } from './use-notifications';

const LEVEL_DOT: Record<NotificationLevel, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
  info: 'bg-slate-400',
};

export function JobToasts() {
  const { jobs, jobsReady, notifications, notificationsReady, repos } = usePreviewState();
  const navigate = useNavigate();
  // Only jobs that START while the page is open announce (e.g. a repository
  // just connected). Jobs already in flight on arrival — a run resumed after a
  // reload — stay silent: the user didn't just start them, and every sign-in
  // reloads the page.
  const announced = useRef<Set<string> | null>(null);
  // The same rule for notifications: what the feed held when the page loaded
  // is history, not news.
  const heard = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!notificationsReady) return;
    if (heard.current === null) {
      heard.current = new Set(notifications.map((n) => n.id));
      return;
    }
    for (const landed of notifications) {
      if (heard.current.has(landed.id)) continue;
      heard.current.add(landed.id);
      const href = notificationHref(landed, repos);
      announceNotification(landed, href ? () => navigate(href) : null);
    }
  }, [notifications, notificationsReady, repos, navigate]);

  useEffect(() => {
    // The "already in flight on arrival" snapshot is only honest once the
    // async run reads are in — taken any earlier it would be empty, and a scan
    // resumed across a reload would announce itself.
    if (!jobsReady) return;
    if (announced.current === null) {
      announced.current = new Set(jobs.map((job) => job.id));
      return;
    }
    for (const job of jobs) {
      if (announced.current.has(job.id)) continue;
      announced.current.add(job.id);
      announceJob(job, () => navigate(job.href));
    }
  }, [jobs, jobsReady, navigate]);

  return null;
}

/**
 * A landed notification, in the same one-line shape as a start: what happened
 * in the job's own words, and the way to where it happened.
 */
function announceNotification(n: NotificationView, open: (() => void) | null) {
  toast.custom(
    (id) => (
      <div className="flex w-full items-center gap-3 text-xs">
        <span className={`h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[n.level]}`} aria-hidden />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{n.title}</span>
          {n.body && <span className="text-muted-foreground"> {n.body}</span>}
        </span>
        {open && (
          <button
            type="button"
            onClick={() => {
              toast.dismiss(id);
              open();
            }}
            className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground hover:underline"
          >
            Open
            <ArrowUpRight className="h-3 w-3" />
          </button>
        )}
        <button
          type="button"
          onClick={() => toast.dismiss(id)}
          aria-label="Dismiss"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    ),
    { style: { width: 'max-content', maxWidth: 'min(90vw, 640px)' } },
  );
}

function announceJob(job: JobChain, openAgent: () => void) {
  toast.custom((id) => (
    <div className="flex w-full items-center gap-3 text-xs">
      <span className="h-2 w-2 shrink-0 rounded-full bg-sky-500" aria-hidden />
      <span className="min-w-0 flex-1 whitespace-nowrap">
        <span className="font-medium">{job.title}</span>
        <span className="text-muted-foreground"> started</span>
      </span>
      <button
        type="button"
        onClick={() => {
          toast.dismiss(id);
          openAgent();
        }}
        className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground hover:underline"
      >
        Open conversation
        <ArrowUpRight className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => toast.dismiss(id)}
        aria-label="Dismiss"
        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  ), { style: { width: 'max-content', maxWidth: 'min(90vw, 640px)' } });
}
