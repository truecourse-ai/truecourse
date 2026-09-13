/**
 * One flow, as its own page (`/preview/flows/:flowId?repo=`): the breadcrumb
 * back to Flows, then the vendored flow workspace (`GuardFlowsPane`), pinned to
 * this one flow. A scenario or finding the workspace opens rides the same URL
 * tabs it always did. The reads are the server's, re-read
 * when a generate or a run lands.
 *
 * The flows of every repository are ONE list now, so this page belongs to the
 * Flows page rather than to a repository tab: the repository it is read through
 * comes in as a prop and rides the address as `?repo=`.
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
import { FLOWS_BASE, flowHref, flowsHref } from '@/preview/pages/flow-hrefs';
import { useGuardTabJump } from './tab-jump';
import { useGuardRefresh } from './use-guard-refresh';

export function FlowPage({ repo, flowId }: { repo: Repo; flowId: string }) {
  useGuardTabJump(repo.id);
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
        if (target && target !== flowId) navigate(flowHref(target, repo.id));
        else if (target === flowId) urlTabs.deselect();
        else urlTabs.open(id, pinned);
      },
      close: (id) => {
        if (id === own) navigate(flowsHref(repo.id));
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
        crumbs={[{ label: 'Flows', to: FLOWS_BASE }]}
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
