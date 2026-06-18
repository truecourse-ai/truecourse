/**
 * Enterprise repo chrome — replaces the OSS repo Header (logo + back +
 * Code-Analysis/BL-Drift section switcher + vertical rail) with a clean repo
 * title row, a ref label (default branch, or the PR being viewed), and a
 * horizontal BL-Drift tab bar. The console sidebar already owns the brand +
 * global nav, so this stays repo-scoped.
 *
 * It reuses the same navigation state (leftTab) — only the chrome differs; the
 * panels behind each tab are unchanged. Which ref is shown is URL-driven
 * (`?pr=N`), not a selector here — the Pull requests feed deep-links into it.
 */

import { ExternalLink, GitBranch } from 'lucide-react';
import type { ReactNode } from 'react';
import type { GithubRunSummary } from '@truecourse/shared';
import type { DashboardSection, LeftTab, TabDescriptor } from '@/navigation/registry';
import { EeSectionSwitch } from '@/ee/EeSectionSwitch';

const PR_PILL: Record<GithubRunSummary['conclusion'], string> = {
  success: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/30',
  failure: 'bg-red-500/10 text-red-400 ring-red-500/30',
  neutral: 'bg-muted text-muted-foreground ring-border',
};

/**
 * Read-only ref indicator: the default branch, or — when viewing a PR (`?pr=N`)
 * — a conclusion-coloured "PR #N" pill plus the PR's head branch. The pill is
 * itself the link to the PR on GitHub (when `repoName` is known).
 */
function RefLabel({
  repoName,
  branch,
  prNumber,
  prBranch,
  prConclusion,
}: {
  repoName?: string;
  branch?: string;
  prNumber?: number | null;
  prBranch?: string | null;
  prConclusion?: GithubRunSummary['conclusion'];
}) {
  if (prNumber != null) {
    const pillClass = `inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ring-1 ${PR_PILL[prConclusion ?? 'neutral']}`;
    return (
      <span className="inline-flex items-center gap-2">
        {repoName ? (
          <a
            href={`https://github.com/${repoName}/pull/${prNumber}`}
            target="_blank"
            rel="noreferrer"
            title="View pull request on GitHub"
            className={`${pillClass} transition-opacity hover:opacity-80`}
          >
            PR #{prNumber}
            <ExternalLink className="h-3 w-3" />
          </a>
        ) : (
          <span className={pillClass}>PR #{prNumber}</span>
        )}
        {prBranch && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5" />
            <span className="max-w-[16rem] truncate">{prBranch}</span>
          </span>
        )}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <GitBranch className="h-3.5 w-3.5" />
      {branch ?? 'default branch'}
    </span>
  );
}

export function EeRepoChrome({
  repoName,
  branch,
  tabs,
  activeTab,
  onTabChange,
  section,
  onSectionChange,
  prNumber,
  prBranch,
  prConclusion,
  actions,
}: {
  repoName?: string;
  branch?: string;
  tabs: TabDescriptor[];
  activeTab: LeftTab | null;
  onTabChange: (tab: LeftTab) => void;
  /** Active lens (Code Quality / Verification) — drives the segmented switch. */
  section?: DashboardSection;
  onSectionChange?: (next: DashboardSection) => void;
  /** When set, the page is scoped to this pull request (`?pr=N`). */
  prNumber?: number | null;
  /** The PR's head branch (from its stored gate diff) — shown next to the pill. */
  prBranch?: string | null;
  /** The PR's gate conclusion — colours the pill. */
  prConclusion?: GithubRunSummary['conclusion'];
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
        {repoName ? (
          <RefLabel
            repoName={repoName}
            branch={branch}
            prNumber={prNumber}
            prBranch={prBranch}
            prConclusion={prConclusion}
          />
        ) : null}
        {/* Mode switch — LEFT-anchored, so the per-tab actions (right-anchored
            below) can appear/disappear without shoving it sideways. */}
        {section && onSectionChange && (
          <EeSectionSwitch section={section} onSectionChange={onSectionChange} />
        )}
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
