// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * The repository console: one header, ONE menu, no toggle.
 *
 * The section switcher is gone with Code Analysis, so the left menu here is not
 * a switcher between products, it is the tabs of the one thing this repository
 * has: Coverage first (how much of the spec is proven), then Corpus (the
 * documents and conflicts, by version), Sources, Tests, Interfaces, Runs, Activity, Dependencies, and the
 * repository's Settings last. There is no pull request page: a PR is seen
 * through its runs (the Pull request filter in Runs) and, when it changed spec
 * documents, through its coverage version in Coverage.
 *
 * The tab is in the URL, so a tab is a place: it can be linked, and Runs can
 * hand a test to Tests without either of them owning the other's pane.
 */

import { Link, useParams } from 'react-router-dom';
import { ChevronRight, FolderGit2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { SessionPage, SessionsActivityView } from '@/preview/activity/SessionsActivityView';
import { ProviderIcon, SideMenu } from '@/preview/ui/bits';
import { StatusWord, CONCLUSION_TONE } from '@/preview/ui/status-word';
import { guardForRepo } from '@/preview/data';
import { usePreviewState } from '@/preview/shell/preview-state';
import { PREVIEW_BASE } from '@/preview/shell/PreviewShell';
import { CorpusPage } from './CorpusPage';
import { CorpusTab } from './CorpusTab';
import { CoverageTab } from './CoverageTab';
import { DependenciesTab } from './DependenciesTab';
import { DependencyPage } from './DependencyPage';
import { InterfacePage } from './InterfacePage';
import { InterfacesTab } from './InterfacesTab';
import { RunPage } from './RunPage';
import { RunsTab } from './RunsTab';
import { SettingsTab } from './SettingsTab';
import { SourcePage } from './SourcePage';
import { SourcesTab } from './SourcesTab';
import { TestPage } from './TestPage';
import { TestsTab } from './TestsTab';

const TABS = [
  { id: 'coverage', label: 'Coverage', group: 'work' },
  { id: 'corpus', label: 'Corpus', group: 'work' },
  { id: 'tests', label: 'Tests', group: 'work' },
  { id: 'runs', label: 'Runs', group: 'work' },
  { id: 'sources', label: 'Sources', group: 'setup' },
  { id: 'interfaces', label: 'Interfaces', group: 'setup' },
  { id: 'dependencies', label: 'Dependencies', group: 'setup' },
  { id: 'activity', label: 'Activity', group: 'setup' },
  { id: 'settings', label: 'Settings', group: 'setup' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function RepoConsole() {
  const { slug, tab, runId, flowId, sourceId, interfaceId, dependencyName, sessionId, docRef, conflictId } = useParams<{
    slug: string;
    tab?: string;
    runId?: string;
    flowId?: string;
    sourceId?: string;
    interfaceId?: string;
    dependencyName?: string;
    sessionId?: string;
    docRef?: string;
    conflictId?: string;
  }>();
  const { repos, workspace } = usePreviewState();
  const repo = repos.find((r) => r.id === slug);
  const guard = guardForRepo(slug);
  const implied = runId
    ? 'runs'
    : flowId
      ? 'tests'
      : sourceId
        ? 'sources'
        : interfaceId
          ? 'interfaces'
          : dependencyName
            ? 'dependencies'
            : sessionId
              ? 'activity'
              : docRef || conflictId
                ? 'corpus'
                : undefined;
  const active = (TABS.find((t) => t.id === (tab ?? implied))?.id ?? 'coverage') as TabId;

  if (!repo) {
    return (
      <EmptyState
        icon={FolderGit2}
        title="No such repository"
        body={
          <>
            Nothing is connected under that address.{' '}
            <Link to={PREVIEW_BASE} className="text-primary hover:underline">
              Open Home
            </Link>
            .
          </>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-sm">
          <Link
            to={PREVIEW_BASE}
            className="font-semibold text-foreground hover:underline"
          >
            {workspace.name}
          </Link>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          <ProviderIcon provider={repo.provider} className="h-4 w-4" />
          <h1 className="font-semibold text-foreground">{repo.fullName}</h1>
        </nav>
        <span className="font-mono text-[11px] text-muted-foreground">{repo.defaultBranch}</span>
        {repo.onboarding && <span className="text-[11px] text-sky-600 dark:text-sky-400">onboarding in flight</span>}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          <span className="text-[11px] text-muted-foreground">{repo.lastCheck.at}</span>
          <StatusWord tone={CONCLUSION_TONE[repo.lastCheck.conclusion]} word={repo.lastCheck.word} />
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <SideMenu
          label="Repository sections"
          activeId={active}
          groups={[
            {
              items: TABS.filter((t) => t.group === 'work').map((t) => ({ id: t.id, label: t.label, to: `${PREVIEW_BASE}/repos/${repo.id}/${t.id}` })),
            },
            {
              label: 'Setup',
              items: TABS.filter((t) => t.group === 'setup').map((t) => ({ id: t.id, label: t.label, to: `${PREVIEW_BASE}/repos/${repo.id}/${t.id}` })),
            },
          ]}
        />

        <div className="min-h-0 min-w-0 flex-1">
          {active === 'settings' ? (
            <SettingsTab repo={repo} />
          ) : !guard ? (
            <EmptyState
              icon={FolderGit2}
              title="Onboarding has not produced anything yet"
              body="The first scan, setup and generation are still running. Watch them in Activity."
            />
          ) : active === 'coverage' ? (
            <CoverageTab repo={repo} />
          ) : active === 'corpus' ? (
            docRef ? (
              <CorpusPage repo={repo} kind="doc" itemId={decodeURIComponent(docRef)} />
            ) : conflictId ? (
              <CorpusPage repo={repo} kind="conflict" itemId={decodeURIComponent(conflictId)} />
            ) : (
              <CorpusTab repo={repo} />
            )
          ) : active === 'tests' ? (
            flowId ? (
              <TestPage repo={repo} flowId={decodeURIComponent(flowId)} />
            ) : (
              <TestsTab repo={repo} />
            )
          ) : active === 'interfaces' ? (
            interfaceId ? (
              <InterfacePage repo={repo} interfaceId={decodeURIComponent(interfaceId)} />
            ) : (
              <InterfacesTab repo={repo} />
            )
          ) : active === 'runs' ? (
            runId ? (
              <RunPage repo={repo} runId={decodeURIComponent(runId)} />
            ) : (
              <RunsTab repo={repo} />
            )
          ) : active === 'activity' ? (
            sessionId ? (
              <SessionPage repoId={repo.id} sessionId={decodeURIComponent(sessionId)} />
            ) : (
              <SessionsActivityView repoId={repo.id} />
            )
          ) : active === 'sources' ? (
            sourceId ? (
              <SourcePage repo={repo} sourceId={decodeURIComponent(sourceId)} />
            ) : (
              <SourcesTab repo={repo} />
            )
          ) : dependencyName ? (
            <DependencyPage repo={repo} name={decodeURIComponent(dependencyName)} />
          ) : (
            <DependenciesTab repo={repo} />
          )}
        </div>
      </div>
    </div>
  );
}
