/**
 * One test, as its own page (`/tests/:flowId`): the breadcrumb back to Tests,
 * then the vendored test workspace for a flow (`GuardFlowsPane`), pinned to
 * this one flow. A scenario or finding the workspace opens rides the same URL
 * tabs it always did. A connected repository's reads are the server's, re-read
 * when a generate or a run lands; a fixture repository's are its fixtures.
 */

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/preview/ui/bits';
import { GuardFlowsPane } from '@/preview/vendor/components/guard/GuardFlowsPane';
import { useGuardClaims } from '@/preview/vendor/hooks/useGuardClaims';
import { useGuardDecisions } from '@/preview/vendor/hooks/useGuardDecisions';
import { useGuardFlows } from '@/preview/vendor/hooks/useGuardFlows';
import { flowTabId, tabFlowId, useGuardFlowTabs } from '@/preview/vendor/hooks/useGuardFlowTabs';
import { useGuardInterfaces } from '@/preview/vendor/hooks/useGuardInterfaces';
import { useGuardScenarios } from '@/preview/vendor/hooks/useGuardScenarios';
import { useGuardView } from '@/preview/vendor/hooks/useGuardView';
import type { GuardTabsState } from '@/preview/vendor/hooks/useGuardTabs';
import { guardTestBinds } from '@/preview/vendor/lib/guard-tests';
import type { Repo } from '@/preview/data/types';
import { useGuardTabJump } from './tab-jump';
import { useGuardRefresh } from './use-guard-refresh';

export function TestPage({ repo, flowId }: { repo: Repo; flowId: string }) {
  useGuardTabJump();
  const navigate = useNavigate();
  const reloadKey = useGuardRefresh(repo, ['guard-generate', 'guard-run']);
  const flows = useGuardFlows(repo.id, true, reloadKey);
  const interfaces = useGuardInterfaces(repo.id, true, reloadKey);
  const claims = useGuardClaims(repo.id, true, reloadKey);
  const tests = useGuardScenarios(repo.id, true, reloadKey);
  const decisions = useGuardDecisions(repo.id, true, reloadKey);
  const urlTabs = useGuardFlowTabs(repo.id);
  const { openSpecSection, openGuardInterface, openGuardExternals } = useGuardView();

  const flow = flows.view?.flows.find((f) => f.flowId === flowId) ?? null;

  // The page IS the flow: its tab is always open and pinned; opening another
  // flow from inside the workspace (an epic's chain) navigates to that page;
  // scenario and finding tabs keep riding the URL as they always did.
  const tabs = useMemo<GuardTabsState>(() => {
    const own = flowTabId(flowId);
    const others = urlTabs.openTabs.filter((t) => tabFlowId(t.id) === null);
    return {
      activeId: urlTabs.activeId && tabFlowId(urlTabs.activeId) === null ? urlTabs.activeId : own,
      openTabs: [{ id: own, pinned: true }, ...others],
      open: (id, pinned) => {
        const target = tabFlowId(id);
        if (target && target !== flowId) navigate(`/preview/repos/${repo.id}/tests/${encodeURIComponent(target)}`);
        else if (target === flowId) urlTabs.deselect();
        else urlTabs.open(id, pinned);
      },
      close: (id) => {
        if (id === own) navigate(`/preview/repos/${repo.id}/tests`);
        else urlTabs.close(id);
      },
      deselect: urlTabs.deselect,
    };
  }, [flowId, navigate, repo.id, urlTabs]);

  const claimTitles = useMemo(
    () => Object.fromEntries((claims.view?.claims ?? []).map((c) => [c.id, c.title])),
    [claims.view],
  );
  const binds = useMemo(() => guardTestBinds(tests.rows), [tests.rows]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        crumbs={[{ label: 'Tests', to: `/preview/repos/${repo.id}/tests` }]}
        title={flow?.title ?? flowId}
      />
      <div className="min-h-0 flex-1">
        <GuardFlowsPane
          repoId={repo.id}
          view={flows.view}
          loading={flows.loading}
          error={flows.error}
          tabs={tabs}
          interfaces={interfaces.view?.interfaces ?? null}
          claimTitles={claimTitles}
          binds={binds}
          reloadKey={reloadKey}
          decisions={decisions}
          onOpenSpec={openSpecSection}
          onOpenInterface={openGuardInterface}
          onOpenExternals={openGuardExternals}
        />
      </div>
    </div>
  );
}
