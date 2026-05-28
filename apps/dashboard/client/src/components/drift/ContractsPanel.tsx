/**
 * Contracts sidebar — presentation-only. Tree data is owned by the
 * top-level `useContractsTree` hook in RepoPage so it survives
 * tab switches. Single-click in the tree opens a transient tab in
 * the right pane; double-click pins it.
 *
 * When the last Generate run produced validation issues they appear at
 * the top of the panel as a persistent, scrollable list so the user
 * can inspect them without time pressure (the toast only shows the count).
 */

import { useState } from 'react';
import { Loader2, AlertCircle, Folder, FileCode2, ChevronRight, ChevronDown } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import type { ContractsTree, IlValidationIssue } from '@/lib/api';

interface ContractsPanelProps {
  tree: ContractsTree | null;
  isLoading: boolean;
  error: string | null;
  activePath: string | null;
  /** Validation issues from the last Generate run; shown persistently at top. */
  validationIssues?: IlValidationIssue[];
  /** Single-click opens a transient tab; double-click pins it. */
  onOpen: (path: string, pinned: boolean) => void;
}

export function ContractsPanel({ tree, isLoading, error, activePath, validationIssues, onOpen }: ContractsPanelProps) {
  if (isLoading && !tree) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <span>{error}</span>
      </div>
    );
  }
  if (!tree || !tree.hasContracts) {
    return (
      <EmptyState
        icon={FileCode2}
        title="No contracts yet"
        body={
          <>
            Resolve all open conflicts in <strong>Spec</strong>, click{' '}
            <strong>Apply</strong>, then click <strong>Generate</strong> here to
            extract TC contracts.
          </>
        }
      />
    );
  }

  const issues = validationIssues ?? [];
  const hardIssues = issues.filter((i) => i.severity === 'hard');
  const softIssues = issues.filter((i) => i.severity === 'soft');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {issues.length > 0 && (
        <ValidationIssuesSection hardIssues={hardIssues} softIssues={softIssues} />
      )}
      <div className="flex-1 overflow-auto">
        {tree.modules.map((m) => (
          <ModuleGroup
            key={m.name}
            label={m.name}
            files={m.files}
            activePath={activePath}
            onOpen={onOpen}
          />
        ))}
      </div>
    </div>
  );
}

function ModuleGroup({
  label,
  files,
  activePath,
  onOpen,
}: {
  label: string;
  files: Array<{ name: string; path: string }>;
  activePath: string | null;
  onOpen: (path: string, pinned: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const childActive = files.some((f) => f.path === activePath);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`sticky top-0 z-10 flex w-full items-center justify-between gap-2 border-b border-border bg-card px-4 py-1.5 text-left text-[10px] uppercase tracking-wider hover:text-foreground ${
          childActive ? 'text-foreground' : 'text-muted-foreground'
        }`}
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {open ? (
            <ChevronDown className="h-3 w-3 shrink-0" />
          ) : (
            <ChevronRight className="h-3 w-3 shrink-0" />
          )}
          <Folder className="h-3 w-3 shrink-0" />
          <span className="truncate">{label}</span>
        </div>
        <span>{files.length}</span>
      </button>
      {open &&
        files.map((f) => {
          const isActive = f.path === activePath;
          // Strip the module-name prefix from the display name so the
          // sidebar shows the operation/entity name, not a redundant
          // `orders/operations/get-api-orders.tc`.
          const display = f.path.replace(/^[^/]+\//, '');
          return (
            <button
              key={f.path}
              type="button"
              onClick={() => onOpen(f.path, false)}
              onDoubleClick={() => onOpen(f.path, true)}
              className={`flex w-full items-center gap-2 border-b border-border/60 px-4 py-2 pl-9 text-left text-[13px] transition-colors ${
                isActive
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
              }`}
              title={`${f.path} — click to preview, double-click to pin`}
            >
              <FileCode2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{display}</span>
            </button>
          );
        })}
    </div>
  );
}

function ValidationIssuesSection({
  hardIssues,
  softIssues,
}: {
  hardIssues: IlValidationIssue[];
  softIssues: IlValidationIssue[];
}) {
  const [open, setOpen] = useState(true);
  const total = hardIssues.length + softIssues.length;
  const hasHard = hardIssues.length > 0;
  const headerTone = hasHard ? 'text-red-400' : 'text-amber-400';
  const borderTone = hasHard ? 'border-red-500/30' : 'border-amber-500/30';
  const bgTone = hasHard ? 'bg-red-500/5' : 'bg-amber-500/5';

  return (
    <div className={`shrink-0 border-b ${borderTone} ${bgTone}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full items-center justify-between px-4 py-1.5 text-[10px] uppercase tracking-wider ${headerTone} hover:opacity-80`}
        aria-expanded={open}
      >
        <div className="flex items-center gap-1.5">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span>Validation issues</span>
        </div>
        <span>{total}</span>
      </button>
      {open && (
        <ul className="max-h-72 overflow-auto px-2 pb-2">
          {hardIssues.map((issue, i) => (
            <IssueRow key={`hard-${issue.artifactKey}-${i}`} issue={issue} />
          ))}
          {softIssues.map((issue, i) => (
            <IssueRow key={`soft-${issue.artifactKey}-${i}`} issue={issue} />
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
      ? 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300'
      : 'border-amber-500/30 bg-amber-500/5 text-amber-800 dark:text-amber-200';
  return (
    <li className={`mt-1.5 rounded border ${tone} px-2 py-1.5`}>
      <div className="flex items-start gap-2">
        <span
          className={`mt-0.5 shrink-0 rounded px-1 py-0.5 text-[9px] uppercase tracking-wider ${
            issue.severity === 'hard'
              ? 'bg-red-500/20 text-red-700 dark:text-red-300'
              : 'bg-amber-500/20 text-amber-800 dark:text-amber-200'
          }`}
        >
          {issue.severity}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[11px] text-foreground">
              {issue.artifactKey}
            </span>
            {issue.tcSource && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="shrink-0 text-[10px] text-muted-foreground hover:text-foreground"
              >
                {open ? 'hide' : 'source'}
              </button>
            )}
          </div>
          <div className="mt-0.5 break-words text-[11px]">{issue.message}</div>
          {open && issue.tcSource && (
            <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted/40 p-2 font-mono text-[10px] text-muted-foreground">
              {issue.tcSource}
            </pre>
          )}
        </div>
      </div>
    </li>
  );
}
