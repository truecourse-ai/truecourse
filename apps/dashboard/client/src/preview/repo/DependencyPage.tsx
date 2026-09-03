/**
 * One dependency, as its own page (`/dependencies/:name`): the breadcrumb back
 * to Dependencies, then the agentic dependency detail (`GuardDependencyDetail`:
 * what it is, what it needs, the supplied values form, the tests it blocks).
 */

import { Link } from 'react-router-dom';
import { ChevronRight, Loader2, Plug } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { GuardDependencyDetail } from '@/preview/vendor/components/guard/GuardDependencyDetail';
import { useGuardDependencies } from '@/preview/vendor/hooks/useGuardDependencies';
import { useGuardView } from '@/preview/vendor/hooks/useGuardView';
import type { Repo } from '@/preview/data/types';
import { useGuardTabJump } from './tab-jump';
import { useGuardRefresh } from './use-guard-refresh';

export function DependencyPage({ repo, name }: { repo: Repo; name: string }) {
  useGuardTabJump();
  const reloadKey = useGuardRefresh(repo, ['guard-setup']);
  const { view, loading, save, saving } = useGuardDependencies(repo.id, true, reloadKey);
  const { openGuardFlow } = useGuardView();
  // A CTA elsewhere names a SERVICE; the entry it resolves to may be keyed by its
  // own name and cover several services.
  const dependency =
    view?.dependencies.find((d) => d.name === name) ??
    view?.dependencies.find((d) => (d.service?.services ?? []).includes(name)) ??
    null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link to={`/preview/repos/${repo.id}/dependencies`} className="shrink-0 font-semibold text-foreground hover:underline">
            Dependencies
          </Link>
          <ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <h1 className="min-w-0 truncate font-semibold text-foreground">{dependency?.name ?? name}</h1>
        </nav>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {dependency ? (
          <GuardDependencyDetail
            key={dependency.name}
            repoId={repo.id}
            dependency={dependency}
            saving={saving}
            onSave={(patch) => save(dependency.name, patch)}
            onOpenFlow={openGuardFlow}
          />
        ) : loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <EmptyState icon={Plug} title="No such dependency" body="Nothing is declared under that name." />
        )}
      </div>
    </div>
  );
}
