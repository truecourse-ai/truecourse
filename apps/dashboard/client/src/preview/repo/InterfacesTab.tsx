/**
 * Interfaces: a flat table of the repository's interface catalog (one row per
 * invocable thing: a CLI command, an API operation, a web task), the way
 * Repositories lists repositories. A row opens the interface as its own page
 * (`/interfaces/:id`, see ./InterfacePage.tsx). Search by title or id; Surface
 * and Origin are the filters.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { GuardInterfaceRow, GuardInterfacesView } from '@/preview/vendor/shared';
import { guardDriver } from '@/preview/vendor/shared';
import { CHIP_CLASS, PageHeader } from '@/preview/ui/bits';
import { FilterBar } from '@/preview/ui/filter-bar';
import { useGuardInterfaces } from '@/preview/vendor/hooks/useGuardInterfaces';
import type { Repo } from '@/preview/data/types';
import { useGuardTabJump } from './tab-jump';
import { useGuardRefresh } from './use-guard-refresh';

/**
 * Why the catalog is empty, in the catalog's own words: nothing mapped yet, or
 * mapped and every surface came out empty — named per surface with the ladder
 * that read it (`tree`, `probes`), so a reader knows what setup looked at.
 */
function emptyCatalogReason(view: GuardInterfacesView | null): string {
  if (!view || view.unavailable === 'no-working-tree') return 'No interface catalog is stored for this repository yet.';
  if (!view.mapped) return 'No interfaces mapped yet. Setup derives the catalog.';
  const read = view.surfaces
    .filter((s) => s.source)
    .map((s) => `${s.label.toLowerCase()} by ${String(s.source)}`);
  return read.length > 0
    ? `Setup read ${read.join(', ')} and derived no interfaces.`
    : 'Setup derived no interfaces.';
}

export function InterfacesTab({ repo }: { repo: Repo }) {
  useGuardTabJump();
  const navigate = useNavigate();
  // A jump that names an interface (`?interface=`, from a test's interfaces) lands
  // on that interface's page: the table is the index, the page is the interface.
  const [params] = useSearchParams();
  const jumpTo = params.get('interface');
  useEffect(() => {
    if (jumpTo) navigate(`/preview/repos/${repo.id}/interfaces/${encodeURIComponent(jumpTo)}`, { replace: true });
  }, [jumpTo, navigate, repo.id]);

  const reloadKey = useGuardRefresh(repo, ['guard-setup']);
  const interfaces = useGuardInterfaces(repo.id, true, reloadKey);
  const [query, setQuery] = useState('');
  const [surfaceFilter, setSurfaceFilter] = useState<string[]>([]);
  const [originFilter, setOriginFilter] = useState<string[]>([]);

  const all: GuardInterfaceRow[] = useMemo(() => interfaces.view?.interfaces ?? [], [interfaces.view]);

  const surfaceOptions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of all) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
    return [...counts.entries()].map(([key, count]) => ({ key, label: guardDriver(key)?.label ?? key, count }));
  }, [all]);
  const originOptions = useMemo(
    () =>
      (['derived', 'authored'] as const)
        .map((key) => ({ key, label: key, count: all.filter((i) => (i.origin ?? 'derived') === key).length }))
        .filter((o) => o.count > 0),
    [all],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter(
      (i) =>
        (!q || i.title.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)) &&
        (surfaceFilter.length === 0 || surfaceFilter.includes(i.type)) &&
        (originFilter.length === 0 || originFilter.includes(i.origin ?? 'derived')),
    );
  }, [all, query, surfaceFilter, originFilter]);

  const openInterface = (id: string) => navigate(`/preview/repos/${repo.id}/interfaces/${encodeURIComponent(id)}`);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title="Interfaces"
        subtitle={rows.length === all.length ? `${all.length}` : `${rows.length} of ${all.length}`}
      />
      <div className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-1 border-b border-border px-6 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search interfaces"
          placeholder="Search interfaces"
          className="w-64 rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <div className="flex flex-wrap items-center gap-x-4 [&>div]:border-0 [&>div]:px-0 [&>div]:py-0">
          <FilterBar
            label="Surface"
            ariaLabel="Filter interfaces by surface"
            options={surfaceOptions}
            selected={surfaceFilter}
            onChange={setSurfaceFilter}
            multi
          />
          <FilterBar
            label="Origin"
            ariaLabel="Filter interfaces by origin"
            options={originOptions}
            selected={originFilter}
            onChange={setOriginFilter}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full border-collapse text-[13px]" aria-label="Interfaces">
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Interface</th>
              <th className="px-3 py-2 text-left font-semibold">Surface</th>
              <th className="px-3 py-2 text-left font-semibold">Group</th>
              <th className="px-3 py-2 text-left font-semibold">Origin</th>
              <th className="px-6 py-2 text-right font-semibold">Used by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr
                key={i.id}
                tabIndex={0}
                onClick={() => openInterface(i.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openInterface(i.id);
                }}
                className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40 focus:bg-muted/40 focus:outline-none"
              >
                <td className="px-6 py-2.5">
                  <span className="block truncate text-foreground">{i.title}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{i.id}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className={CHIP_CLASS}>{guardDriver(i.type)?.label ?? i.type}</span>
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{i.group ?? ''}</td>
                <td className="px-3 py-2.5">
                  <span className={CHIP_CLASS}>{i.origin ?? 'derived'}</span>
                </td>
                <td className="px-6 py-2.5 text-right tabular-nums text-foreground">
                  {i.flows.length} test{i.flows.length === 1 ? '' : 's'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-muted-foreground">
                  {interfaces.loading
                    ? 'Loading interfaces.'
                    : interfaces.error
                      ? interfaces.error
                      : all.length === 0
                        ? emptyCatalogReason(interfaces.view)
                        : 'No interface matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
