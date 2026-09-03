/**
 * A job that starts while the page is open announces itself ONCE, as a toast
 * carrying a link to its session in the repository's Activity tab. Jobs already
 * in flight when the page loads never announce. Nothing in the toast moves: no
 * steps, no counter, no bar. Progress lives in one place, the Activity surface,
 * and the toast only says where to look. Renders nothing itself.
 *
 * Both kinds of job pass through here. A REAL run (a repository connected by
 * URL, scanning) carries its own preview address and lands on the real Activity
 * view; a fixture job derives one from the repository it names.
 *
 * A real run that FAILS announces the same way, once, on the transition — with
 * the run's own reason and a link to the run itself. Both announcements are
 * session-local sets: nothing is persisted, and a reload starts them over.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowUpRight, X } from 'lucide-react';
import type { JobChain } from '@/preview/data/types';
import type { RunFailure } from './real-runs';
import { usePreviewState } from './preview-state';
import { PREVIEW_BASE } from './PreviewShell';

const slugOf = (fullName: string): string => fullName.split('/').slice(-1)[0] ?? fullName;

export function JobToasts() {
  const { jobs, jobsReady, runFailures } = usePreviewState();
  const navigate = useNavigate();
  // Only jobs that START while the page is open announce (e.g. a repository
  // just connected). Jobs already in flight on arrival — fixtures seeded into
  // initial state, or a run resumed after a reload — stay silent: the user
  // didn't just start them, and every sign-in reloads the page.
  const announced = useRef<Set<string> | null>(null);
  // The same rule for failures: a run that was already failed when the page
  // loaded is history, not news.
  const mourned = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!jobsReady) return;
    if (mourned.current === null) {
      mourned.current = new Set(runFailures.map((f) => f.id));
      return;
    }
    for (const failure of runFailures) {
      if (mourned.current.has(failure.id)) continue;
      mourned.current.add(failure.id);
      announceFailure(failure, () => navigate(failure.href));
    }
  }, [runFailures, jobsReady, navigate]);

  useEffect(() => {
    // The "already in flight on arrival" snapshot is only honest once the
    // async real-run reads are in — seeded any earlier it would hold just the
    // fixtures, and a scan resumed across a reload would announce itself.
    if (!jobsReady) return;
    if (announced.current === null) {
      announced.current = new Set(jobs.map((job) => job.id));
      return;
    }
    for (const job of jobs) {
      if (announced.current.has(job.id)) continue;
      announced.current.add(job.id);
      // A real run carries its own Activity address (the registry slug is not
      // always the repository's last path segment); a fixture derives one.
      const to = job.href ?? `${PREVIEW_BASE}/repos/${slugOf(job.repoFullName)}/activity`;
      announceJob(job, () => navigate(to));
    }
  }, [jobs, jobsReady, navigate]);

  return null;
}

/**
 * A failed run, in the same one-line shape as a start: what broke, in the
 * run's own words, and the way to the run that broke.
 */
function announceFailure(failure: RunFailure, openRun: () => void) {
  toast.custom(
    (id) => (
      <div className="flex w-full items-start gap-3 text-xs">
        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-red-500" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{failure.title}</span>
          <span className="block text-muted-foreground">{failure.body}</span>
        </span>
        <button
          type="button"
          onClick={() => {
            toast.dismiss(id);
            openRun();
          }}
          className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground hover:underline"
        >
          Open run
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
    ),
    { style: { width: 'max-content', maxWidth: 'min(90vw, 640px)' } },
  );
}

function announceJob(job: JobChain, openActivity: () => void) {
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
          openActivity();
        }}
        className="inline-flex shrink-0 items-center gap-1 font-medium text-foreground hover:underline"
      >
        Open Activity
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
