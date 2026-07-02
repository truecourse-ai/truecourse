/**
 * Right-pane detail for one Generate result item — a validation issue or a
 * coverage gap selected from the Contracts panel list. It opens through the
 * shared contracts tab set (preview/pin, URL `?contract=`), so the panel stays a
 * compact list and the message / tcSource / explanation live here.
 *
 * `itemKey` is `issue::<index>` or `gap::<index>` into the run's arrays.
 */

import { AlertCircle } from 'lucide-react';
import type { IlValidationIssue, IlCoverageGap } from '@/lib/api';

interface GenerateResultDetailProps {
  itemKey: string;
  issues: IlValidationIssue[];
  gaps: IlCoverageGap[];
}

export function GenerateResultDetail({ itemKey, issues, gaps }: GenerateResultDetailProps) {
  const sep = itemKey.indexOf('::');
  const kind = itemKey.slice(0, sep);
  const idx = Number(itemKey.slice(sep + 2));

  if (kind === 'issue') {
    const issue = issues[idx];
    if (!issue) return <Missing />;
    const hard = issue.severity === 'hard';
    const tone = hard
      ? 'bg-red-500/20 text-red-700 dark:text-red-300'
      : 'bg-amber-500/20 text-amber-800 dark:text-amber-200';
    return (
      <div className="flex h-full flex-col overflow-auto p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${tone}`}>
            {issue.severity}
          </span>
          <span className="truncate font-mono text-[13px] text-foreground">{issue.artifactKey}</span>
        </div>
        <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Message</div>
        <pre className="mb-3 overflow-auto rounded border border-border bg-muted/30 p-3 font-mono text-[12px] leading-relaxed text-foreground">
          {issue.message}
        </pre>
        <p className="mb-3 text-[11px] text-muted-foreground/80">
          {hard
            ? 'Hard issue — this artifact failed to parse/resolve and was dropped (not written).'
            : 'Soft issue — the artifact was kept; a cross-reference did not resolve.'}
        </p>
        {issue.repairAttempted && (
          <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[12px] text-amber-800 dark:text-amber-200">
            <div className="font-medium">Repair was attempted and failed.</div>
            {issue.repairFailReason && (
              <pre className="mt-1 overflow-auto whitespace-pre-wrap font-mono text-[11px]">
                {issue.repairFailReason}
              </pre>
            )}
          </div>
        )}
        {issue.tcSource && (
          <>
            <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Generated tcSource</div>
            <pre className="overflow-auto rounded border border-border bg-muted/30 p-3 text-[12px] leading-relaxed text-foreground">
              {issue.tcSource}
            </pre>
          </>
        )}
      </div>
    );
  }

  const gap = gaps[idx];
  if (!gap) return <Missing />;
  return (
    <div className="flex h-full flex-col overflow-auto p-4">
      <div className="mb-3 flex items-center gap-2">
        <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-amber-800 dark:text-amber-200">
          gap
        </span>
        <span className="truncate font-mono text-[13px] text-foreground">
          {gap.kind}:{gap.identity}
        </span>
      </div>
      <div className="mb-4">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Area</div>
        <div className="font-mono text-[13px] text-foreground">{gap.areaId}</div>
      </div>
      {gap.hint && (
        <div className="mb-4">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Enumerated as</div>
          <div className="text-[13px] text-foreground">{gap.hint}</div>
        </div>
      )}
      {gap.reason ? (
        <>
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Why it&apos;s still a gap</div>
          <p className="text-[13px] text-muted-foreground">{gap.reason}</p>
        </>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          This target was enumerated for the area but no contract was generated for it — the doc may not
          actually define it, or it was emitted under a different identity in another area.
        </p>
      )}
    </div>
  );
}

function Missing() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
      <AlertCircle className="h-5 w-5" />
      <span>This result is no longer available — re-run Generate.</span>
    </div>
  );
}
