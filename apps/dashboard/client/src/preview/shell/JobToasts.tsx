/**
 * A job announces itself ONCE, as a toast carrying a link to its session in the
 * repository's Activity tab. Nothing in the toast moves: no steps, no counter,
 * no bar. Progress lives in one place, the Activity surface, and the toast only
 * says where to look. Renders nothing itself.
 *
 * Both kinds of job pass through here. A REAL run (a repository connected by
 * URL, scanning) carries its own preview address and lands on the real Activity
 * view; a fixture job derives one from the repository it names.
 */

import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ArrowUpRight, X } from 'lucide-react';
import type { JobChain } from '@/preview/data/types';
import { usePreviewState } from './preview-state';
import { PREVIEW_BASE } from './PreviewShell';

const slugOf = (fullName: string): string => fullName.split('/').slice(-1)[0] ?? fullName;

export function JobToasts() {
  const { jobs } = usePreviewState();
  const navigate = useNavigate();
  const announced = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const job of jobs) {
      if (announced.current.has(job.id)) continue;
      announced.current.add(job.id);
      // A real run carries its own Activity address (the registry slug is not
      // always the repository's last path segment); a fixture derives one.
      const to = job.href ?? `${PREVIEW_BASE}/repos/${slugOf(job.repoFullName)}/activity`;
      announceJob(job, () => navigate(to));
    }
  }, [jobs, navigate]);

  return null;
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
