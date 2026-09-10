/**
 * One dependency, as its own page (`/dependencies/:name`): the breadcrumb back
 * to Dependencies, then the agentic dependency detail (`GuardDependencyDetail`:
 * what it is, what it needs, the supplied values form, the tests it blocks).
 */

import { Loader2, Plug } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/preview/ui/bits';
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
      <PageHeader
        crumbs={[{ label: 'Dependencies', to: `/preview/repos/${repo.id}/dependencies` }]}
        title={dependency?.name ?? 'Dependency'}
      />
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
          <EmptyState icon={Plug} title="No such dependency" body="No configurable dependency is available at this address." />
        )}
      </div>
    </div>
  );
}
