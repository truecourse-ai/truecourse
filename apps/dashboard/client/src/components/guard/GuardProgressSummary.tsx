import type { GuardFlowProgress } from '@truecourse/shared';
import { GUARD_EXECUTION_LABELS, GUARD_GENERATION_LABELS, guardCoverageText } from '@/lib/guard-progress';

export function GuardProgressSummary({ progress }: { progress?: GuardFlowProgress }) {
  if (!progress) return null;
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-label="Execution and coverage">
      <span>Execution: {GUARD_EXECUTION_LABELS[progress.execution]}</span>
      <span>Coverage: {guardCoverageText(progress)}</span>
      {progress.generation !== 'ready' && <span>{GUARD_GENERATION_LABELS[progress.generation]}</span>}
      {progress.category !== 'behavior' && <span>{progress.category === 'system' ? 'System contract' : 'Mixed contract'}</span>}
    </span>
  );
}
