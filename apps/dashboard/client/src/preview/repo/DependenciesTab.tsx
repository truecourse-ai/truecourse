/**
 * Dependencies: a flat table of the repository's dependency catalog (the three
 * classes: step-creatable, seedable, supplied), the way Repositories lists
 * repositories. A row opens the dependency as its own page
 * (`/dependencies/:name`, see ./DependencyPage.tsx). Search by name; Class and
 * State are the filters.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CHIP_CLASS, PageHeader } from '@/preview/ui/bits';
import { FilterBar } from '@/preview/ui/filter-bar';
import { useGuardDependencies } from '@/preview/vendor/hooks/useGuardDependencies';
import { GUARD_DEPENDENCY_STATE, guardDependencyMatches, guardDependencyType } from '@/preview/vendor/lib/guard-dependencies';
import type { GuardDependencyRow, GuardDependencyState } from '@/preview/vendor/types/guard-dependencies';
import type { Repo } from '@/preview/data/types';
import { useGuardTabJump } from './tab-jump';

const CLASS_LABEL: Record<GuardDependencyRow['class'], string> = {
  'step-creatable': 'step-creatable',
  seedable: 'seedable',
  supplied: 'supplied',
};

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

  const { view, loading } = useGuardDependencies(repo.id, true);
  const [query, setQuery] = useState('');
  const [classFilter, setClassFilter] = useState<string[]>([]);
  const [stateFilter, setStateFilter] = useState<string[]>([]);

  const all: GuardDependencyRow[] = useMemo(() => view?.dependencies ?? [], [view]);

  const classOptions = useMemo(
    () =>
      (Object.keys(CLASS_LABEL) as GuardDependencyRow['class'][])
        .map((key) => ({ key, label: CLASS_LABEL[key], count: all.filter((d) => d.class === key).length }))
        .filter((o) => o.count > 0),
    [all],
  );
  const stateOptions = useMemo(
    () =>
      (Object.keys(GUARD_DEPENDENCY_STATE) as GuardDependencyState[])
        .map((key) => ({ key, label: GUARD_DEPENDENCY_STATE[key].label, count: all.filter((d) => d.state === key).length }))
        .filter((o) => o.count > 0),
    [all],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (d) =>
        (!q || guardDependencyMatches(d, q)) &&
        (classFilter.length === 0 || classFilter.includes(d.class)) &&
        (stateFilter.length === 0 || (d.state != null && stateFilter.includes(d.state))),
    );
  }, [all, query, classFilter, stateFilter]);

  const openDependency = (name: string) =>
    navigate(`/preview/repos/${repo.id}/dependencies/${encodeURIComponent(name)}`);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title="Dependencies"
        subtitle={rows.length === all.length ? `${all.length}` : `${rows.length} of ${all.length}`}
      />
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-6 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search dependencies"
          placeholder="Search dependencies"
          className="w-64 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex flex-wrap items-center gap-x-4 [&>div]:border-0 [&>div]:px-0 [&>div]:py-0">
          <FilterBar
            label="Class"
            ariaLabel="Filter dependencies by class"
            options={classOptions}
            selected={classFilter}
            onChange={setClassFilter}
            multi
          />
          <FilterBar
            label="State"
            ariaLabel="Filter dependencies by state"
            options={stateOptions}
            selected={stateFilter}
            onChange={setStateFilter}
            multi
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]" aria-label="Dependencies">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Dependency</th>
              <th className="px-3 py-2 text-left font-semibold">Class</th>
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
                    <span className="block truncate text-foreground">{d.name}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{d.summary}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={CHIP_CLASS}>{CLASS_LABEL[d.class]}</span>
                  </td>
                  <td className="px-3 py-2.5 text-muted-foreground">{type?.label ?? ''}</td>
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
                <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                  {loading ? 'Loading dependencies.' : 'No dependency matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
