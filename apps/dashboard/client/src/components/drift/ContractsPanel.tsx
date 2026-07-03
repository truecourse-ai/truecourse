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
import type { ContractsTree, IlValidationIssue, IlCoverageGap } from '@/lib/api';

interface ContractsPanelProps {
  tree: ContractsTree | null;
  isLoading: boolean;
  error: string | null;
  activePath: string | null;
  /** Validation issues from the last Generate run; shown as a compact list. */
  validationIssues?: IlValidationIssue[];
  /** Coverage gaps (enumerated targets with no contract) from the last Generate run. */
  gaps?: IlCoverageGap[];
  /**
   * Single-click opens a transient tab; double-click pins it. Used for both
   * `.tc` file paths and result keys (`issue::<i>` / `gap::<i>`) — they share
   * the contracts right-pane tab set.
   */
  onOpen: (path: string, pinned: boolean) => void;
  /** Hosted (EE): contracts are generated server-side, not via an Apply/Generate button. */
  hosted?: boolean;
  /**
   * PR / Git-Diff view: which contract paths the PR added / removed / modified vs
   * the baseline. When set, the full tree is shown with each changed file badged
   * (new / changed) plus a "Removed in this PR" section — mirroring the Spec tab,
   * which always shows the whole corpus. Null in normal mode (no badges).
   */
  prDiff?: { added: string[]; removed: string[]; modified: string[] } | null;
}

export function ContractsPanel({
  tree,
  isLoading,
  error,
  activePath,
  validationIssues,
  gaps,
  onOpen,
  hosted = false,
  prDiff,
}: ContractsPanelProps) {
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
          hosted ? (
            <>
              Resolve the open conflicts in the <strong>Spec</strong> tab —
              contracts are generated automatically once every conflict is
              resolved.
            </>
          ) : (
            <>
              Resolve all open conflicts in <strong>Spec</strong>, click{' '}
              <strong>Apply</strong>, then click <strong>Generate</strong> here to
              extract TC contracts.
            </>
          )
        }
      />
    );
  }

  const issues = validationIssues ?? [];
  // Keep each issue's index in the original array so the `issue::<i>` key is stable.
  const indexedIssues = issues.map((issue, i) => ({ issue, i }));
  const coverageGaps = gaps ?? [];

  const added = new Set(prDiff?.added ?? []);
  const modified = new Set(prDiff?.modified ?? []);
  const removed = prDiff?.removed ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {issues.length > 0 && (
        <ValidationIssuesSection indexedIssues={indexedIssues} activePath={activePath} onOpen={onOpen} />
      )}
      {coverageGaps.length > 0 && (
        <GapsSection gaps={coverageGaps} activePath={activePath} onOpen={onOpen} />
      )}
      <div className="flex-1 overflow-auto">
        {removed.length > 0 && (
          <div className="border-b border-border">
            <div className="sticky top-0 z-10 border-b border-border bg-card px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Removed · {removed.length}
            </div>
            {removed.map((p) => (
              <div
                key={p}
                className="flex items-center gap-2 border-b border-border/60 px-4 py-2 pl-9 text-[13px] text-muted-foreground line-through"
                title={`${p} — removed vs baseline`}
              >
                <FileCode2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{p.replace(/^[^/]+\//, '')}</span>
              </div>
            ))}
          </div>
        )}
        {tree.modules.map((m) => (
          <ModuleGroup
            key={m.name}
            label={m.name}
            files={m.files}
            activePath={activePath}
            onOpen={onOpen}
            added={added}
            modified={modified}
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
  added,
  modified,
}: {
  label: string;
  files: Array<{ name: string; path: string; provenance?: 'workspace' | 'repo'; inferred?: boolean }>;
  activePath: string | null;
  onOpen: (path: string, pinned: boolean) => void;
  added?: Set<string>;
  modified?: Set<string>;
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
              title={`${f.path} — click to preview, double-click to pin${
                f.provenance === 'workspace' ? ' · inherited from workspace Knowledge' : ''
              }`}
            >
              <FileCode2 className="h-3 w-3 shrink-0" />
              <span className="truncate">{display}</span>
              {f.provenance === 'workspace' && (
                <span
                  className="ml-auto shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-primary"
                  title="Inherited from workspace Knowledge — shared by every repo"
                >
                  workspace
                </span>
              )}
              {f.inferred && (
                <span
                  className="ml-auto shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300"
                  title="Promoted from an inferred decision"
                >
                  inferred
                </span>
              )}
              {added?.has(f.path) && (
                <span className="ml-auto shrink-0 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-300">
                  new
                </span>
              )}
              {!added?.has(f.path) && modified?.has(f.path) && (
                <span className="ml-auto shrink-0 rounded bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-blue-600 dark:text-blue-300">
                  changed
                </span>
              )}
            </button>
          );
        })}
    </div>
  );
}

function ValidationIssuesSection({
  indexedIssues,
  activePath,
  onOpen,
}: {
  indexedIssues: { issue: IlValidationIssue; i: number }[];
  activePath: string | null;
  onOpen: (path: string, pinned: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  const hasHard = indexedIssues.some((x) => x.issue.severity === 'hard');
  const headerTone = hasHard ? 'text-red-400' : 'text-amber-400';
  const borderTone = hasHard ? 'border-red-500/30' : 'border-amber-500/30';
  const bgTone = hasHard ? 'bg-red-500/5' : 'bg-amber-500/5';
  // Hard first, then soft — both keyed by original index for a stable `issue::<i>`.
  const ordered = [...indexedIssues].sort(
    (a, b) => Number(b.issue.severity === 'hard') - Number(a.issue.severity === 'hard'),
  );

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
        <span>{indexedIssues.length}</span>
      </button>
      {open && (
        <ul className="max-h-72 overflow-auto px-2 pb-2">
          {ordered.map(({ issue, i }) => {
            const key = `issue::${i}`;
            return (
              <ResultRow
                key={key}
                badge={issue.severity}
                badgeTone={
                  issue.severity === 'hard'
                    ? 'bg-red-500/20 text-red-700 dark:text-red-300'
                    : 'bg-amber-500/20 text-amber-800 dark:text-amber-200'
                }
                label={issue.artifactKey}
                active={activePath === key}
                onOpen={onOpen}
                openKey={key}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

function GapsSection({
  gaps,
  activePath,
  onOpen,
}: {
  gaps: IlCoverageGap[];
  activePath: string | null;
  onOpen: (path: string, pinned: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="shrink-0 border-b border-amber-500/30 bg-amber-500/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-1.5 text-[10px] uppercase tracking-wider text-amber-400 hover:opacity-80"
        aria-expanded={open}
      >
        <div className="flex items-center gap-1.5">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <span>Coverage gaps</span>
        </div>
        <span>{gaps.length}</span>
      </button>
      {open && (
        <ul className="max-h-72 overflow-auto px-2 pb-2">
          {gaps.map((g, i) => {
            const key = `gap::${i}`;
            return (
              <ResultRow
                key={key}
                label={`${g.kind}:${g.identity}`}
                active={activePath === key}
                onOpen={onOpen}
                openKey={key}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * A compact, clickable result row — opens its detail in the right pane via the
 * shared contracts tab model: single-click = transient preview, double-click =
 * pin (same as `.tc` files and spec docs).
 */
function ResultRow({
  badge,
  badgeTone,
  label,
  active,
  onOpen,
  openKey,
}: {
  /** Optional leading badge — used for issue severity (hard/soft); omitted for gaps. */
  badge?: string;
  badgeTone?: string;
  label: string;
  active: boolean;
  onOpen: (path: string, pinned: boolean) => void;
  openKey: string;
}) {
  return (
    <li className="mt-1">
      <button
        type="button"
        onClick={() => onOpen(openKey, false)}
        onDoubleClick={() => onOpen(openKey, true)}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left ${
          active ? 'bg-accent' : 'hover:bg-muted/50'
        }`}
      >
        {badge && (
          <span className={`shrink-0 rounded px-1 py-0.5 text-[9px] uppercase tracking-wider ${badgeTone}`}>
            {badge}
          </span>
        )}
        <span className="truncate font-mono text-[11px] text-foreground">{label}</span>
      </button>
    </li>
  );
}
