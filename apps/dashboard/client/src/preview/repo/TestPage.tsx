// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * One test, as its own page (`/tests/:flowId`): the breadcrumb back to Tests,
 * then the test workspace the agentic branch renders for a flow (`GuardFlowsPane`
 * over fake data), pinned to this one flow. A scenario or finding the workspace
 * opens rides the same URL tabs it always did.
 */

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
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

export function TestPage({ repo, flowId }: { repo: Repo; flowId: string }) {
  useGuardTabJump();
  const navigate = useNavigate();
  const flows = useGuardFlows(repo.id, true);
  const interfaces = useGuardInterfaces(repo.id, true);
  const claims = useGuardClaims(repo.id, true);
  const tests = useGuardScenarios(repo.id, true);
  const decisions = useGuardDecisions(repo.id, true);
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
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link to={`/preview/repos/${repo.id}/tests`} className="shrink-0 font-semibold text-foreground hover:underline">
            Tests
          </Link>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <h1 className="min-w-0 truncate font-semibold text-foreground">{flow?.title ?? flowId}</h1>
        </nav>
      </header>
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
          decisions={decisions}
          onOpenSpec={openSpecSection}
          onOpenInterface={openGuardInterface}
          onOpenExternals={openGuardExternals}
        />
      </div>
    </div>
  );
}
