/**
 * Live job progress popup — the EE mirror of the OSS analyze/spec popup
 * (apps/dashboard/client SpecProgressPopup): a bottom-center stack of cards, one
 * per active background job, each a stepped checklist streamed in over SSE.
 *
 * Driven purely by the provider's `activeJobs` — a job leaves the set on its
 * terminal `job.progress` (succeeded/failed), so the card disappears on its own.
 * Steps ride the live event (`job.progress.steps`); we fall back to the coarse
 * `message` until they arrive.
 */

import { Check, CircleX, Loader2 } from 'lucide-react';
import type { JobView } from '@truecourse/shared';

function jobTitle(job: JobView): string {
  switch (job.type) {
    case 'knowledge.sync':
      return 'Syncing knowledge';
    case 'repo.baseline':
      return 'Scanning repository';
    case 'repo.contracts':
    case 'workspace.contracts':
      return 'Updating contracts';
    default:
      return 'Working';
  }
}

export function JobProgressPopup({ jobs }: { jobs: JobView[] }) {
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  if (active.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-40 flex w-80 -translate-x-1/2 flex-col gap-2">
      {active.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}

function JobCard({ job }: { job: JobView }) {
  const steps = job.progress.steps;
  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
      {/* Title only — no header spinner. The single spinner lives on the active
          step (or the fallback line), so it always reflects what's running. */}
      <div className="mb-2">
        <span className="text-[11px] font-medium text-foreground">{jobTitle(job)}</span>
      </div>
      {steps && steps.length > 0 ? (
        <div className="space-y-1">
          {steps.map((s) => (
            <div key={s.key} className="flex items-center gap-2">
              <div className="shrink-0 translate-y-px">
                {s.status === 'done' && <Check className="h-3.5 w-3.5 text-emerald-500" />}
                {s.status === 'active' && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                {s.status === 'error' && <CircleX className="h-3.5 w-3.5 text-destructive" />}
                {s.status === 'pending' && (
                  <div className="h-2.5 w-2.5 rounded-full border border-muted-foreground/30" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <span
                  className={`text-[11px] leading-[18px] ${
                    s.status === 'active'
                      ? 'font-medium text-foreground'
                      : s.status === 'done'
                        ? 'text-muted-foreground'
                        : s.status === 'error'
                          ? 'text-destructive'
                          : 'text-muted-foreground/60'
                  }`}
                >
                  {s.label}
                  {s.detail && s.status !== 'pending' && (
                    <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/70">
                      {s.detail}
                    </span>
                  )}
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
          <span className="text-[11px] text-muted-foreground">
            {job.progress.message ?? 'Working…'}
          </span>
        </div>
      )}
    </div>
  );
}
