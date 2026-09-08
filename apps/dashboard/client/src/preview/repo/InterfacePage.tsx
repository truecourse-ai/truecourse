/** One catalog row as a full page. Older task links resolve to its screen and expanded action. */
import { useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { guardDriver, type GuardDriverId } from '@truecourse/shared';
import { GuardInterfacesPane } from '@/components/guard/GuardInterfacesPane';
import { useGuardFlows } from '@/hooks/useGuardFlows';
import { useGuardInterfaces } from '@/hooks/useGuardInterfaces';
import type { GuardTabsState } from '@/hooks/useGuardTabs';
import { placeSelectionForInterface } from '@/lib/interface-pom';
import type { Repo } from '@/preview/data/types';
import { interfaceCatalog } from './interface-catalog';
import { useGuardTabJump } from './tab-jump';
import { useGuardRefresh } from './use-guard-refresh';

export function InterfacePage({ repo, interfaceId }: { repo: Repo; interfaceId: string }) {
  useGuardTabJump();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const reloadKey = useGuardRefresh(repo, ['guard-setup']);
  const interfaces = useGuardInterfaces(repo.id, true, reloadKey);
  const flows = useGuardFlows(repo.id, true, reloadKey);
  const catalog = useMemo(() => interfaceCatalog(interfaces.view), [interfaces.view]);
  const legacy = interfaces.view?.interfaces.find((i) => i.id === interfaceId);
  const selection = legacy ? placeSelectionForInterface(legacy, interfaces.view?.resources?.[legacy.type]) : interfaceId;
  const row = catalog.rows.find((r) => r.id === selection);
  const recipeDriver = interfaceId.startsWith('recipe:') ? guardDriver(interfaceId.slice('recipe:'.length)) : undefined;
  const recipeSurface = recipeDriver ? recipeDriver.id as GuardDriverId : null;
  // An explicit empty member means the user collapsed an action reached through an old task URL.
  const member = params.has('member') ? params.get('member') : legacy?.id ?? null;
  const title = recipeSurface ? `${recipeDriver?.label} recipe` : row ? `${row.method ? `${row.method} ` : ''}${row.title}` : interfaceId;
  const base = `/preview/repos/${repo.id}/interfaces`;

  const tabs = useMemo<GuardTabsState>(() => ({
    activeId: selection,
    openTabs: [{ id: selection, pinned: true }],
    open: (id) => navigate(`${base}/${encodeURIComponent(id)}`),
    close: () => navigate(base),
    selectOverview: () => navigate(base),
  }), [selection, navigate, base]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link to={base} className="shrink-0 font-semibold text-foreground hover:underline">Interfaces</Link>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <h1 className="min-w-0 truncate font-semibold text-foreground">{title}</h1>
        </nav>
      </header>
      <div className="min-h-0 flex-1">
        <GuardInterfacesPane
          repoId={repo.id}
          view={interfaces.view}
          loading={interfaces.loading || (!!recipeSurface && flows.loading)}
          error={interfaces.error ?? (recipeSurface ? flows.error : null)}
          tabs={tabs}
          showTabs={false}
          member={member}
          onMember={(id) => setParams((previous) => {
            const next = new URLSearchParams(previous);
            next.set('member', id ?? '');
            return next;
          }, { replace: true })}
          recipe={flows.view?.recipe ?? null}
          recipeSurface={recipeSurface}
          onOpenFlow={(id) => navigate(`/preview/repos/${repo.id}/tests/${encodeURIComponent(id)}`)}
        />
      </div>
    </div>
  );
}
