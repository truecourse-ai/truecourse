/**
 * The repository console: one header, ONE menu, no toggle.
 *
 * The section switcher is gone with Code Analysis, so the left menu here is not
 * a switcher between products, it is the tabs of the one thing this repository
 * has: Runs first (what this repository's tests did, and when), then the setup
 * group, Context (which workspace sources this repository reads), Interfaces,
 * Dependencies and the repository's Settings. Every tab reads the server: the
 * runs it stored, the interface catalog derived from its tree, the dependency
 * catalog its setup wrote and the sources it is linked to.
 *
 * FLOWS ARE NOT A TAB HERE any more: a flow is the workspace's, listed across
 * every repository on the Flows page, and one flow is a page of its own
 * (`/preview/flows/<id>?repo=<id>`). Generating them is still a REPOSITORY
 * action, so it sits in the Runs tab's header.
 *
 * DOCUMENTATION IS NOT A TAB HERE any more: a source is a workspace object and
 * the corpus is the workspace's, so the documents, their coverage, their
 * conflicts and the scan that curates them live on Context, and a document's
 * coverage page is `/preview/context/doc/<ref>?repo=<id>`. This tab only says
 * which of them this repository reads. The agent's own work is not a tab
 * either: it lives on the Agent page, narrowed to this repository. There is no
 * pull request page: a PR is seen through its runs (the Pull request filter in
 * Runs).
 *
 * The tab is in the URL, so a tab is a place: it can be linked, and a run can
 * hand a flow to the Flows page without either of them owning the other's pane.
 */

import { Link, useParams } from 'react-router-dom';
import { FolderGit2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader, ProviderIcon, SideMenu } from '@/preview/ui/bits';
import { StatusWord, CONCLUSION_TONE } from '@/preview/ui/status-word';
import { usePreviewState } from '@/preview/shell/preview-state';
import { PREVIEW_BASE } from '@/preview/shell/PreviewShell';
import { ContextTab } from './ContextTab';
import { DependenciesTab } from './DependenciesTab';
import { DependencyPage } from './DependencyPage';
import { InterfacePage } from './InterfacePage';
import { InterfacesTab } from './InterfacesTab';
import { RunPage } from './RunPage';
import { RunsTab } from './RunsTab';
import { SettingsTab } from './SettingsTab';

const TABS = [
  { id: 'runs', label: 'Runs', group: 'work' },
  { id: 'context', label: 'Context', group: 'setup' },
  { id: 'interfaces', label: 'Interfaces', group: 'setup' },
  { id: 'dependencies', label: 'Dependencies', group: 'setup' },
  { id: 'settings', label: 'Settings', group: 'setup' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function RepoConsole() {
  const { slug, tab, runId, interfaceId, dependencyName } = useParams<{
    slug: string;
    tab?: string;
    runId?: string;
    interfaceId?: string;
    dependencyName?: string;
  }>();
  const { repos, llmProvider } = usePreviewState();
  const repo = repos.find((r) => r.id === slug);
  const implied = runId
    ? 'runs'
    : interfaceId
      ? 'interfaces'
      : dependencyName
        ? 'dependencies'
        : undefined;
  const active = (TABS.find((t) => t.id === (tab ?? implied))?.id ?? 'runs') as TabId;

  if (!repo) {
    return (
      <EmptyState
        icon={FolderGit2}
        title="No such repository"
        body={
          <>
            Nothing is connected under that address.{' '}
            <Link to={`${PREVIEW_BASE}/code`} className="text-primary hover:underline">
              Open Code
            </Link>
            .
          </>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={[{ label: 'Code', to: `${PREVIEW_BASE}/code` }]}
        icon={<ProviderIcon provider={repo.provider} className="mr-1.5 inline-block h-4 w-4 align-text-bottom" />}
        title={repo.fullName}
        subtitle={
          <span className="flex items-center gap-3">
            <span className="font-mono">{repo.defaultBranch}</span>
            {repo.onboarding && <span className="text-sky-600 dark:text-sky-400">onboarding in flight</span>}
          </span>
        }
        right={
          <>
            <span className="text-[11px] text-muted-foreground">{repo.lastCheck.at}</span>
            <StatusWord tone={CONCLUSION_TONE[repo.lastCheck.conclusion]} word={repo.lastCheck.word} />
          </>
        }
      />

      {/* A repository with no provider set cannot scan at all, and every tab
          below it is waiting on a scan. Said once, where the work is. */}
      {llmProvider === 'missing' && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/30 px-6 py-1.5 text-[11px] text-amber-500">
          No LLM provider configured. The agent cannot run until one is set.
          <Link to={`${PREVIEW_BASE}/settings/models`} className="font-medium underline">
            Set one in Settings
          </Link>
        </div>
      )}

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
          ) : active === 'context' ? (
            // The sources are the WORKSPACE's, read over `/api/context/sources`,
            // and the switches save this repository's links over
            // `/api/repos/<id>/context/bindings`.
            <ContextTab repo={repo} />
          ) : active === 'interfaces' ? (
            // The interface catalog is derived from this repository's own tree,
            // read over `/api/repos/<id>/guard/interfaces`: the full-width
            // catalog of screens, operations and commands, and each row as its
            // own page.
            interfaceId ? (
              <InterfacePage repo={repo} interfaceId={decodeURIComponent(interfaceId)} />
            ) : (
              <InterfacesTab repo={repo} />
            )
          ) : active === 'dependencies' ? (
            // The dependency catalog is what this repository's setup stored,
            // joined with the instances registered through this page, over
            // `/api/repos/<id>/guard/dependencies`.
            dependencyName ? (
              <DependencyPage repo={repo} name={decodeURIComponent(dependencyName)} />
            ) : (
              <DependenciesTab repo={repo} />
            )
          ) : (
            // Every run the server stored, the baseline runs and the
            // pull-request head runs the gate wrote, over
            // `/api/repos/<id>/guard/history?all=1`, and one run's snapshot with
            // its evidence as its own page.
            runId ? (
              <RunPage repo={repo} runId={decodeURIComponent(runId)} />
            ) : (
              <RunsTab repo={repo} />
            )
          )}
        </div>
      </div>
    </div>
  );
}
