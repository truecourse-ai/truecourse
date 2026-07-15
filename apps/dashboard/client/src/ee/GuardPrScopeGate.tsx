/**
 * Pane gate for PR-scoped guard views: while a `?pr=N` guard scope is
 * unresolved (`resolvePrGuardScope` → loading / no-run) it renders the holding
 * state INSTEAD of its children, so no guard pane ever mounts — and thus never
 * fetches or renders repo-BASELINE guard data — under a PR header.
 */

import { Loader2, PlayCircle } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import type { PrGuardScope } from './pr-guard-scope';

export function GuardPrScopeGate({
  scope,
  children,
}: {
  scope: PrGuardScope;
  children: React.ReactNode;
}) {
  if (scope.state === 'loading') {
    return (
      <div
        role="status"
        aria-label="Resolving pull request scope"
        className="flex h-full w-full items-center justify-center"
      >
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (scope.state === 'no-run') {
    return (
      <EmptyState
        icon={PlayCircle}
        title="Guard gate hasn't run for this pull request yet"
        body="No guard gate run is recorded for this pull request. Its guard results appear here once the gate completes."
      />
    );
  }
  return <>{children}</>;
}
