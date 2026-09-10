import { Link } from 'react-router-dom';
import { Loader2, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGuardGenerate } from '@/hooks/useGuardGenerate';
import { usePreviewState } from '@/preview/shell/preview-state';
import { activityHref } from '@/preview/shell/real-runs';
import type { Repo } from '@/preview/data/types';

/** A manual generation entry point, independent of the previous outcome's classification. */
export function GenerateTestsAction({ repo, disabled = false, label = 'Generate tests' }: {
  repo: Repo;
  disabled?: boolean;
  label?: string;
}) {
  const generate = useGuardGenerate(repo.id);
  const { jobs, jobsReady } = usePreviewState();
  const activeJob = jobs.find((job) => job.repoFullName === repo.fullName);
  const busy = generate.busy || !!activeJob;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" variant="outline" disabled={disabled || busy || !jobsReady} onClick={generate.begin}>
        {busy ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <RotateCw aria-hidden className="h-3.5 w-3.5" />}
        {generate.busy ? 'Starting generation…' : activeJob ? 'Run in progress' : label}
      </Button>
      <Link to={activityHref(repo.id)} className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground">
        View activity
      </Link>
      {activeJob && (
        <span role="status" className="text-xs text-muted-foreground">
          {activeJob.steps.find((step) => step.state === 'active')?.label ?? activeJob.title}
        </span>
      )}
    </div>
  );
}
