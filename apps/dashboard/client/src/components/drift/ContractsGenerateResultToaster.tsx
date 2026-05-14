/**
 * Side effect: surface the latest Contracts Generate result as a
 * toast. Success → emerald, validation issues / skipped → amber,
 * failures → red. Auto-dismiss is handled globally by sonner's default
 * `duration` in App.tsx. The validation-issues toast renders an inline
 * expandable list so per-artifact detail (severity, message, source)
 * stays one click away.
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ContractsGenerateResponse, IlValidationIssue } from '@/lib/api';

interface ContractsGenerateResultToasterProps {
  result: ContractsGenerateResponse | null;
}

export function ContractsGenerateResultToaster({
  result,
}: ContractsGenerateResultToasterProps) {
  const lastShownRef = useRef<unknown>(null);

  useEffect(() => {
    if (!result || result === lastShownRef.current) return;
    lastShownRef.current = result;

    if ('error' in result.il) {
      toast.error('Generate failed', {
        description: result.il.error,
        });
      return;
    }

    if ('skipped' in result.il) {
      toast.warning('Generate skipped', {
        description: result.il.skipped,
        });
      return;
    }

    const issues = result.il.validationIssues ?? [];
    const written = result.il.written;

    if (issues.length === 0) {
      toast.success('Generated', {
        description: `Wrote ${written} IL file${written === 1 ? '' : 's'}.`,
      });
      return;
    }

    const hardCount = issues.filter((i) => i.severity === 'hard').length;
    const softCount = issues.length - hardCount;
    toast.warning('Generated with validation issues', {
      description: (
        <ValidationIssuesDetail
          written={written}
          issues={issues}
          hardCount={hardCount}
          softCount={softCount}
        />
      ),
    });
  }, [result]);

  return null;
}

function ValidationIssuesDetail({
  written,
  issues,
  hardCount,
  softCount,
}: {
  written: number;
  issues: IlValidationIssue[];
  hardCount: number;
  softCount: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div>
        Wrote {written} files · {issues.length} validation issue
        {issues.length === 1 ? '' : 's'}
        {hardCount > 0 && softCount > 0 && (
          <>
            {' '}
            ({hardCount} hard, {softCount} soft)
          </>
        )}
        .
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {open ? 'Hide details' : 'Show details'}
      </button>
      {open && (
        <ul className="mt-2 max-h-60 space-y-1.5 overflow-auto">
          {issues.map((issue, i) => (
            <IssueRow key={`${issue.artifactKey}-${i}`} issue={issue} />
          ))}
        </ul>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: IlValidationIssue }) {
  const [open, setOpen] = useState(false);
  const tone =
    issue.severity === 'hard'
      ? 'border-red-500/30 bg-red-500/5 text-red-300'
      : 'border-amber-500/30 bg-amber-500/5 text-amber-200';
  return (
    <li className={`rounded border ${tone} px-2 py-1.5`}>
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 rounded px-1 py-0.5 text-[9px] uppercase tracking-wider ${
            issue.severity === 'hard'
              ? 'bg-red-500/20 text-red-300'
              : 'bg-amber-500/20 text-amber-200'
          }`}
        >
          {issue.severity}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-foreground">
              {issue.artifactKey}
            </span>
            {issue.tcSource && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="text-[10px] text-muted-foreground hover:text-foreground"
              >
                {open ? 'hide source' : 'show source'}
              </button>
            )}
          </div>
          <div className="mt-0.5 text-[11px]">{issue.message}</div>
          {open && issue.tcSource && (
            <pre className="mt-1 max-h-48 overflow-auto rounded bg-muted/40 p-2 font-mono text-[10px] text-muted-foreground">
              {issue.tcSource}
            </pre>
          )}
        </div>
      </div>
    </li>
  );
}
