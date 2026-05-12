/**
 * Top-of-right-pane toolbar for the Spec tab. Page-level actions
 * (Refresh, Accept all defaults, Apply) live here so the sidebar
 * stays focused on the conflict list. Also surfaces the scan stats
 * and the Apply-result banner.
 */

import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Loader2, RefreshCw, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSpec } from './SpecContext';
import type { IlValidationIssue, SpecApplyResponse } from '@/lib/api';

export function SpecToolbar() {
  const {
    scan,
    loading,
    applying,
    applyResult,
    refresh,
    acceptAllDefaults,
    apply,
  } = useSpec();

  if (!scan) {
    // Without a scan there's nothing to act on. Render a thin spacer
    // so the right pane keeps its rhythm.
    return <div className="h-10 border-b border-border bg-card/40" />;
  }

  const hasOpen = scan.openConflicts.length > 0;
  const scannedAt = scan.scannedAt;

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-card/40 px-6 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          <Stat label="Docs" value={scan.docsScanned} />
          <Stat label="Claims" value={scan.claimsExtracted} />
          <Stat label="Resolved" value={scan.resolved + scan.decided} />
          <Stat label="Open" value={scan.openConflicts.length} highlight={hasOpen} />
          {scannedAt && (
            <span title={new Date(scannedAt).toLocaleString()}>
              · Scanned {formatRelativeTime(scannedAt)}
            </span>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={refresh}
            disabled={loading}
            title="Re-run the scan against the latest docs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={acceptAllDefaults}
            disabled={!hasOpen || loading}
            title="Accept the engine's default pick on every open conflict (chains first, then content)"
          >
            <Wand2 className="mr-2 h-3.5 w-3.5" />
            Accept all defaults
          </Button>
          <Button
            size="sm"
            onClick={apply}
            disabled={applying || loading || hasOpen}
            title={
              hasOpen
                ? 'Resolve all open conflicts first'
                : 'Write the canonical spec and run IL extraction'
            }
          >
            {applying ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Apply
          </Button>
        </div>
      </div>
      {applyResult && <ApplyResultBanner result={applyResult} />}
    </div>
  );
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <span>
      <span className={`font-semibold ${highlight ? 'text-amber-300' : 'text-foreground'}`}>
        {value}
      </span>{' '}
      <span className="uppercase tracking-wider">{label}</span>
    </span>
  );
}

function ApplyResultBanner({ result }: { result: SpecApplyResponse }) {
  const [issuesOpen, setIssuesOpen] = useState(true);

  if ('error' in result.il) {
    return (
      <BannerShell tone="red">
        <span className="font-semibold">Applied.</span> Materialized{' '}
        {result.materialize?.written ?? 0} canonical files. · IL extraction failed
        <span className="ml-2 text-muted-foreground">({result.il.error})</span>
      </BannerShell>
    );
  }
  if ('skipped' in result.il) {
    return (
      <BannerShell tone="amber">
        <span className="font-semibold">Applied.</span> Materialized{' '}
        {result.materialize?.written ?? 0} canonical files. · IL extraction skipped
        <span className="ml-2 text-muted-foreground">({result.il.skipped})</span>
      </BannerShell>
    );
  }

  const issues = result.il.validationIssues ?? [];
  if (issues.length === 0) {
    return (
      <BannerShell tone="emerald">
        <span className="font-semibold">Applied.</span> Materialized{' '}
        {result.materialize?.written ?? 0} canonical files. · IL extraction wrote{' '}
        {result.il.written} files
      </BannerShell>
    );
  }

  const hardCount = issues.filter((i) => i.severity === 'hard').length;
  const softCount = issues.length - hardCount;

  return (
    <BannerShell tone="amber">
      <button
        type="button"
        onClick={() => setIssuesOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left"
        aria-expanded={issuesOpen}
      >
        {issuesOpen ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        <span className="font-semibold">Applied.</span>
        <span>
          Materialized {result.materialize?.written ?? 0} canonical files. · IL
          extraction wrote {result.il.written} files but surfaced{' '}
          <span className="font-semibold">{issues.length}</span> validation
          issue{issues.length === 1 ? '' : 's'}
          {hardCount > 0 && softCount > 0 && (
            <>
              {' '}({hardCount} hard, {softCount} soft)
            </>
          )}
        </span>
      </button>
      {issuesOpen && (
        <ul className="mt-2 space-y-1.5">
          {issues.map((issue, i) => (
            <IssueRow key={`${issue.artifactKey}-${i}`} issue={issue} />
          ))}
        </ul>
      )}
    </BannerShell>
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

function BannerShell({
  tone,
  children,
}: {
  tone: 'red' | 'amber' | 'emerald';
  children: React.ReactNode;
}) {
  const cls = {
    red: 'bg-red-500/10 text-red-300',
    amber: 'bg-amber-500/10 text-amber-300',
    emerald: 'bg-emerald-500/10 text-emerald-300',
  }[tone];
  return (
    <div className={`border-b border-border px-6 py-2 text-xs ${cls}`}>
      {children}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}
