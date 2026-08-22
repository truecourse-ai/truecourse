// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.

/**
 * One interface, as its own page (`/interfaces/:id`): the breadcrumb back to
 * Interfaces, then the agentic interface detail (`GuardInterfacesPane`, the
 * contract in the surface's own words, the sequence diagram, the tests that use
 * it), pinned to this one interface.
 */

import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { GuardInterfacesPane } from '@/preview/vendor/components/guard/GuardInterfacesPane';
import { useGuardFlows } from '@/preview/vendor/hooks/useGuardFlows';
import { useGuardInterfaces } from '@/preview/vendor/hooks/useGuardInterfaces';
import type { GuardTabsState } from '@/preview/vendor/hooks/useGuardTabs';
import { useGuardView } from '@/preview/vendor/hooks/useGuardView';
import type { Repo } from '@/preview/data/types';
import { useGuardTabJump } from './tab-jump';

export function InterfacePage({ repo, interfaceId }: { repo: Repo; interfaceId: string }) {
  useGuardTabJump();
  const navigate = useNavigate();
  const interfaces = useGuardInterfaces(repo.id, true);
  const flows = useGuardFlows(repo.id, true);
  const { openGuardFlow } = useGuardView();
  const row = interfaces.view?.interfaces.find((i) => i.id === interfaceId) ?? null;

  // The page IS the interface: its tab is open and pinned; opening another
  // interface from inside the detail navigates to that page; closing it returns
  // to the table.
  const tabs = useMemo<GuardTabsState>(
    () => ({
      activeId: interfaceId,
      openTabs: [{ id: interfaceId, pinned: true }],
      open: (id) => {
        if (id !== interfaceId) navigate(`/preview/repos/${repo.id}/interfaces/${encodeURIComponent(id)}`);
      },
      close: () => navigate(`/preview/repos/${repo.id}/interfaces`),
      deselect: () => navigate(`/preview/repos/${repo.id}/interfaces`),
    }),
    [interfaceId, navigate, repo.id],
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link to={`/preview/repos/${repo.id}/interfaces`} className="shrink-0 font-semibold text-foreground hover:underline">
            Interfaces
          </Link>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <h1 className="min-w-0 truncate font-semibold text-foreground">{row?.title ?? interfaceId}</h1>
        </nav>
      </header>
      <div className="min-h-0 flex-1">
        <GuardInterfacesPane
          repoId={repo.id}
          view={interfaces.view}
          loading={interfaces.loading}
          error={interfaces.error}
          tabs={tabs}
          recipe={flows.view?.recipe ?? null}
          onOpenFlow={openGuardFlow}
        />
      </div>
    </div>
  );
}
