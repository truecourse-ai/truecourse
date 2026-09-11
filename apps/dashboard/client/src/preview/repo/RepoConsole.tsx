// PREVIEW (UI mock, fake data) with exceptions: on a REAL (provider-connected)
// repository the Interfaces tab reads the server's own
// interface catalog for that repository, the Dependencies tab reads and
// registers against its stored dependency catalog, the Corpus tab reads the
// corpus its scan stored, the Coverage tab reads the stored coverage summary
// over it, the Sources tab reads and edits its stored web sources, and the
// Tests and Runs tabs read what its generate and runs stored.

/**
 * The repository console: one header, ONE menu, no toggle.
 *
 * The section switcher is gone with Code Analysis, so the left menu here is not
 * a switcher between products, it is the tabs of the one thing this repository
 * has: Coverage first (how much of the spec is proven), then Corpus (the
 * documents and conflicts, by version), Sources, Tests, Interfaces, Runs, Dependencies, and the
 * repository's Settings last. The agent's own work is not a tab here: it lives
 * on the Agent page, narrowed to this repository. There is no pull request page: a PR is seen
 * through its runs (the Pull request filter in Runs) and, when it changed spec
 * documents, through its coverage version in Coverage.
 *
 * The tab is in the URL, so a tab is a place: it can be linked, and Runs can
 * hand a test to Tests without either of them owning the other's pane.
 */

import { Link, useParams } from 'react-router-dom';
import { FolderGit2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader, ProviderIcon, SideMenu } from '@/preview/ui/bits';
import { StatusWord, CONCLUSION_TONE } from '@/preview/ui/status-word';
import { guardForRepo } from '@/preview/data';
import { usePreviewState } from '@/preview/shell/preview-state';
import { activityHref } from '@/preview/shell/real-runs';
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
  { id: 'settings', label: 'Settings', group: 'setup' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function RepoConsole() {
  const { slug, tab, runId, flowId, sourceId, interfaceId, dependencyName, docRef, conflictId } = useParams<{
    slug: string;
    tab?: string;
    runId?: string;
    flowId?: string;
    sourceId?: string;
    interfaceId?: string;
    dependencyName?: string;
    docRef?: string;
    conflictId?: string;
  }>();
  const { repos, llmProvider } = usePreviewState();
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
      <PageHeader
        crumbs={[{ label: 'Home', to: PREVIEW_BASE }]}
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

      {/* A real repository with no provider set cannot scan at all, and every
          tab below it is waiting on a scan. Said once, where the work is. */}
      {repo.real && llmProvider === 'missing' && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-amber-500/30 px-6 py-1.5 text-[11px] text-amber-500">
          No LLM provider configured. Spec scans cannot run until one is set.
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
          ) : active === 'coverage' && repo.real ? (
            // REAL, not mock: the coverage of a connected repository is the
            // server's summary over what its scan, generate and runs stored,
            // read over `/api/repos/<id>/guard/*` and `/spec/corpus`. The tab
            // owns its own empty state, so a repository nothing ran on says so
            // here rather than through the fixture gate below.
            <CoverageTab repo={repo} />
          ) : active === 'interfaces' && repo.real ? (
            // REAL, not mock: the interface catalog of a connected repository is
            // derived from that repository's own tree, so this surface reads the
            // server's catalog over `/api/repos/<id>/guard/interfaces`. Same two
            // views as the fixture repositories get: the full-width catalog
            // of screens, operations and commands, and each row as its own page.
            interfaceId ? (
              <InterfacePage repo={repo} interfaceId={decodeURIComponent(interfaceId)} />
            ) : (
              <InterfacesTab repo={repo} />
            )
          ) : active === 'dependencies' && repo.real ? (
            // REAL, not mock: the dependency catalog of a connected repository
            // is what its setup stored, joined with the instances registered
            // through this page, over `/api/repos/<id>/guard/dependencies` —
            // the same two views the fixture repositories get.
            dependencyName ? (
              <DependencyPage repo={repo} name={decodeURIComponent(dependencyName)} />
            ) : (
              <DependenciesTab repo={repo} />
            )
          ) : active === 'tests' && repo.real ? (
            // REAL, not mock: the tests of a connected repository are the flows
            // its generate stored, read over `/api/repos/<id>/guard/flows` and
            // re-read when a generate or a run lands — the same two views the
            // fixture repositories get, the table and one test as its own page.
            flowId ? (
              <TestPage repo={repo} flowId={decodeURIComponent(flowId)} />
            ) : (
              <TestsTab repo={repo} />
            )
          ) : active === 'runs' && repo.real ? (
            // REAL, not mock: every run the server stored for a connected
            // repository — the baseline runs and the pull-request head runs the
            // gate wrote — over `/api/repos/<id>/guard/history?all=1`, and one
            // run's snapshot with its evidence as its own page.
            runId ? (
              <RunPage repo={repo} runId={decodeURIComponent(runId)} />
            ) : (
              <RunsTab repo={repo} />
            )
          ) : active === 'sources' && repo.real ? (
            // REAL, not mock: the documentation sites of a connected repository
            // are its stored web sources, read and edited over
            // `/api/repos/<id>/spec/sources*` — the same two views the fixture
            // repositories get, the table and one site as its own page.
            sourceId ? (
              <SourcePage repo={repo} sourceId={decodeURIComponent(sourceId)} />
            ) : (
              <SourcesTab repo={repo} />
            )
          ) : active === 'corpus' && repo.real ? (
            // REAL, not mock: the corpus of a connected repository is what its
            // scan stored on the server, read over `/api/repos/<id>/spec/*`,
            // with the same two views the fixture repositories get — the table,
            // and one document or conflict as its own page.
            docRef ? (
              <CorpusPage repo={repo} kind="doc" itemId={decodeURIComponent(docRef)} />
            ) : conflictId ? (
              <CorpusPage repo={repo} kind="conflict" itemId={decodeURIComponent(conflictId)} />
            ) : (
              <CorpusTab repo={repo} />
            )
          ) : !guard ? (
            // A real repository with nothing in flight has not started, rather
            // than not finished: promising a run that is not running would be
            // the one thing this page could get wrong.
            <EmptyState
              icon={FolderGit2}
              title={
                repo.real && !repo.onboarding
                  ? 'Nothing has run on this repository yet'
                  : 'Onboarding has not produced anything yet'
              }
              body={
                repo.real && !repo.onboarding ? (
                  <>
                    Start the first scan from{' '}
                    <Link
                      to={`${PREVIEW_BASE}/repos/${repo.id}/corpus`}
                      className="text-primary hover:underline"
                    >
                      Corpus
                    </Link>
                    .
                  </>
                ) : (
                  <>
                    The first scan, setup and generation are still running. Follow them on{' '}
                    <Link to={activityHref(repo.id)} className="text-primary hover:underline">
                      Agent
                    </Link>
                    .
                  </>
                )
              }
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
