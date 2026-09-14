/**
 * Dependencies: supplied resources users can configure. Internal test resources
 * are excluded by useGuardDependencies. A row opens its own detail page. The
 * search box is the whole toolbar: State is a column, and one dimension does
 * not earn a filter row.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/preview/ui/bits';
import { useGuardDependencies } from '@/preview/vendor/hooks/useGuardDependencies';
import { GUARD_DEPENDENCY_STATE, guardDependencyMatches, guardDependencyType } from '@/preview/vendor/lib/guard-dependencies';
import type { GuardDependencyRow } from '@/preview/vendor/types/guard-dependencies';
import type { Repo } from '@/preview/data/types';
import { useGuardTabJump } from './tab-jump';
import { useGuardRefresh } from './use-guard-refresh';

export function DependenciesTab({ repo }: { repo: Repo }) {
  useGuardTabJump();
  const navigate = useNavigate();
  // A jump that names a dependency (`?dependency=`, a "Provide …" CTA) lands on
  // that dependency's page: the table is the index, the page is the dependency.
  const [params] = useSearchParams();
  const jumpTo = params.get('dependency');
  useEffect(() => {
    if (jumpTo) navigate(`/preview/repos/${repo.id}/dependencies/${encodeURIComponent(jumpTo)}`, { replace: true });
  }, [jumpTo, navigate, repo.id]);

  const reloadKey = useGuardRefresh(repo, ['guard-setup', 'guard-externals', 'guard-generate', 'guard-run']);
  const { view, loading, error } = useGuardDependencies(repo.id, true, reloadKey);
  const [query, setQuery] = useState('');

  const all: GuardDependencyRow[] = useMemo(() => view?.dependencies ?? [], [view]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((d) => !q || guardDependencyMatches(d, q));
  }, [all, query]);

  const openDependency = (name: string) =>
    navigate(`/preview/repos/${repo.id}/dependencies/${encodeURIComponent(name)}`);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title="Dependencies"
        subtitle={rows.length === all.length ? `${all.length}` : `${rows.length} of ${all.length}`}
      />
      <div className="min-w-0 shrink-0 border-b border-border px-6 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search dependencies"
          placeholder="Search dependencies"
          className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      <div className="min-h-0 min-w-0 flex-1 overflow-auto">
        <table className="w-full min-w-3xl table-fixed border-collapse text-[13px]" aria-label="Dependencies">
          <colgroup>
            <col />
            <col className="w-36" />
            <col className="w-40" />
            <col className="w-28" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="whitespace-nowrap border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Dependency</th>
              <th className="px-3 py-2 text-left font-semibold">Type</th>
              <th className="px-3 py-2 text-left font-semibold">State</th>
              <th className="px-6 py-2 text-right font-semibold">Used by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const type = guardDependencyType(d);
              const state = d.state ? GUARD_DEPENDENCY_STATE[d.state] : null;
              return (
                <tr
                  key={d.name}
                  tabIndex={0}
                  onClick={() => openDependency(d.name)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') openDependency(d.name);
                  }}
                  className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
                >
                  <td className="px-6 py-2.5">
                    <span className="block truncate text-foreground" title={d.name}>{d.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground" title={d.summary}>{d.summary}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{type?.label ?? ''}</td>
                  <td className="px-3 py-2.5">
                    {state && (
                      <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-foreground">
                        <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${state.dot}`} />
                        {state.label}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-2.5 text-right tabular-nums text-foreground">{d.usedBy > 0 ? d.usedBy : ''}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                  {loading ? 'Loading dependencies.' : error ? error : all.length > 0
                    ? 'No dependency matches.'
                    : view?.detectionAvailable
                      ? 'No dependencies to configure.'
                      : 'Run setup to discover dependencies.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
