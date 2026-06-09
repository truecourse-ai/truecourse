/**
 * Enterprise repo chrome — replaces the OSS repo Header (logo + back +
 * Code-Analysis/BL-Drift section switcher + vertical rail) with a clean repo
 * title row, a ref selector (default branch vs a PR), and a horizontal
 * BL-Drift tab bar. The console sidebar already owns the brand + global nav, so
 * this stays repo-scoped.
 *
 * It reuses the same navigation state (leftTab) — only the chrome differs; the
 * panels behind each tab are unchanged.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, GitBranch } from 'lucide-react';
import type { GithubRunSummary, GithubRunsResponse } from '@truecourse/shared';
import { getServerUrl } from '@/lib/server-url';
import type { LeftTab, TabDescriptor } from '@/navigation/registry';

/**
 * Ref selector: default branch + each PR the gate has a stored snapshot for
 * (its runs). Selecting a PR re-keys every tab to that head SHA. Hidden when the
 * repo has no PR runs yet (nothing but the default branch to show).
 */
function RefSelector({
  repoFullName,
  branch,
  selectedRef,
  onSelectRef,
}: {
  repoFullName: string;
  branch?: string;
  selectedRef: string;
  onSelectRef: (ref: string) => void;
}) {
  const [prs, setPrs] = useState<GithubRunSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch(`${getServerUrl()}/api/ee/github/repos/${repoFullName}/runs`, {
      credentials: 'include',
    })
      .then((r) => (r.ok ? (r.json() as Promise<GithubRunsResponse>) : { runs: [] }))
      .then((d) => {
        if (cancelled) return;
        // Runs come newest-first; keep the latest run (snapshot) per PR.
        const byPr = new Map<number, GithubRunSummary>();
        for (const run of d.runs) if (!byPr.has(run.prNumber)) byPr.set(run.prNumber, run);
        setPrs([...byPr.values()]);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [repoFullName]);

  const mark = (c: GithubRunSummary['conclusion']) =>
    c === 'failure' ? '✗' : c === 'success' ? '✓' : '·';

  // Always shown so the ref control is discoverable; PR options appear once the
  // gate has stored a snapshot for them.
  return (
    <div className="relative inline-flex items-center">
      <GitBranch className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-muted-foreground" />
      <select
        value={selectedRef}
        onChange={(e) => onSelectRef(e.target.value)}
        title="View the default branch or a pull request"
        className="appearance-none rounded-md border border-border bg-background py-1 pl-7 pr-7 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value="">{branch ? `${branch} (default)` : 'default branch'}</option>
        {prs.length > 0 && (
          <optgroup label="Pull requests">
            {prs.map((pr) => (
              <option key={pr.headSha} value={pr.headSha}>
                #{pr.prNumber} {mark(pr.conclusion)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-muted-foreground" />
    </div>
  );
}

export function EeRepoChrome({
  repoName,
  branch,
  tabs,
  activeTab,
  onTabChange,
  selectedRef,
  onSelectRef,
  actions,
}: {
  repoName?: string;
  branch?: string;
  tabs: TabDescriptor[];
  activeTab: LeftTab | null;
  onTabChange: (tab: LeftTab) => void;
  /** Ref switcher state ('' = default branch). Omit to hide the selector. */
  selectedRef?: string;
  onSelectRef?: (ref: string) => void;
  /** Per-tab header actions (e.g. Spec Apply, Verify Run) — reused as-is. */
  actions?: ReactNode;
}) {
  return (
    <div className="shrink-0 border-b border-border bg-card">
      {/* Repo title row */}
      <div className="flex h-12 items-center gap-3 px-4">
        <span className="truncate text-sm font-semibold text-foreground">
          {repoName ?? '…'}
        </span>
        {repoName && onSelectRef ? (
          <RefSelector
            repoFullName={repoName}
            branch={branch}
            selectedRef={selectedRef ?? ''}
            onSelectRef={onSelectRef}
          />
        ) : null}
        {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
      </div>

      {/* Horizontal tab bar */}
      <nav className="flex items-center gap-1 overflow-x-auto px-2">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
