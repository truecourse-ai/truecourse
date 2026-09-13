/**
 * Full-width catalog of screens, operations and commands. Rows open their own
 * detail page. The toolbar is the platform's: the search box across the top,
 * then ONE Add-filter row over both dimensions, never a chip bar per dimension.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { GuardInterfaceRow, GuardInterfacesView } from '@truecourse/shared';
import { guardDriver } from '@truecourse/shared';
import { GuardMethodLabel } from '@/components/guard/GuardMethodLabel';
import { useGuardFlows } from '@/hooks/useGuardFlows';
import { catalogOrigins, catalogUsage, interfaceCatalog } from './interface-catalog';
import { CHIP_CLASS, PageHeader } from '@/preview/ui/bits';
import { FilterBuilder, filterKey, selectedValues, type FilterDimension } from '@/preview/ui/filter-builder';
import { useGuardInterfaces } from '@/hooks/useGuardInterfaces';
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
  const flows = useGuardFlows(repo.id, true, reloadKey);
  const catalog = useMemo(() => interfaceCatalog(interfaces.view), [interfaces.view]);
  const [query, setQuery] = useState('');
  /** One selection over both dimensions, as `dimension:value` keys. */
  const [filters, setFilters] = useState<string[]>([]);
  const surfaceFilter = useMemo(() => selectedValues(filters, 'surface'), [filters]);
  const originFilter = useMemo(() => selectedValues(filters, 'origin'), [filters]);

  const all: GuardInterfaceRow[] = useMemo(() => interfaces.view?.interfaces ?? [], [interfaces.view]);

  const surfaces = useMemo(() => {
    const counts = new Map<string, number>();
    for (const i of all) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
    return [...counts.entries()].map(([key, count]) => ({ key, label: guardDriver(key)?.label ?? key, count }));
  }, [all]);
  const dimensions: FilterDimension[] = useMemo(
    () => [
      {
        key: 'surface',
        label: 'Surface',
        options: surfaces.map((s) => ({ key: filterKey('surface', s.key), label: s.label, count: s.count })),
      },
      {
        key: 'origin',
        label: 'Origin',
        options: (['derived', 'authored'] as const)
          .map((key) => ({
            key: filterKey('origin', key),
            label: key,
            count: all.filter((i) => (i.origin ?? 'derived') === key).length,
          }))
          .filter((o) => o.count > 0),
      },
    ],
    [all, surfaces],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return catalog.rows.filter((row) =>
      (!q || row.search.includes(q)) &&
      (surfaceFilter.length === 0 || surfaceFilter.includes(row.surface)) &&
      (originFilter.length === 0 || catalogOrigins(row).some((origin) => originFilter.includes(origin))),
    );
  }, [catalog, query, surfaceFilter, originFilter]);

  const hidden = catalog.hidden.filter((h) => surfaceFilter.length === 0 || surfaceFilter.includes(h.surface));
  const rowUrl = (id: string) => `/preview/repos/${repo.id}/interfaces/${encodeURIComponent(id)}`;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader
        title="Interfaces"
        subtitle={(['screen', 'operation', 'command', 'entries'] as const).flatMap((kind) => {
          const matching = rows.filter((r) => r.kind === kind);
          const count = kind === 'entries' ? matching.reduce((n, r) => n + r.members.length, 0) : matching.length;
          return count ? [`${count} ${kind === 'entries' ? `entry point${count === 1 ? '' : 's'}` : `${kind}${count === 1 ? '' : 's'}`}`] : [];
        }).join(' · ') || '0 interfaces'}
      />
      <div className="min-w-0 shrink-0 border-b border-border px-6 py-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search interfaces"
          placeholder="Search interfaces"
          className="w-full rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <FilterBuilder
        label="Filter"
        ariaLabel="Filter interfaces"
        dimensions={dimensions}
        selected={filters}
        onChange={setFilters}
      />

      {flows.view?.recipe && (
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-2 text-xs">
          <span className="text-muted-foreground">Preparation</span>
          {surfaces.filter((s) => surfaceFilter.length === 0 || surfaceFilter.includes(s.key)).map((s) => (
            <Link key={s.key} to={rowUrl(`recipe:${s.key}`)} className="rounded-sm text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">{s.label} recipe</Link>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[48rem] table-fixed border-collapse text-[13px]" aria-label="Interfaces">
          <colgroup>
            <col />
            <col className="w-20" />
            <col className="w-24" />
            <col className="w-28" />
            <col className="w-28" />
            <col className="w-28" />
          </colgroup>
          <thead className="sticky top-0 z-10 bg-card">
            <tr className="border-b border-border text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-2 text-left font-semibold">Interface</th>
              <th className="px-3 py-2 text-left font-semibold">Surface</th>
              <th className="px-3 py-2 text-left font-semibold">Kind</th>
              <th className="px-3 py-2 text-right font-semibold">Interfaces</th>
              <th className="px-3 py-2 text-left font-semibold">Origin</th>
              <th className="px-6 py-2 text-right font-semibold">Used by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} onClick={(event) => {
                if (!(event.target as HTMLElement).closest('a')) navigate(rowUrl(row.id));
              }} className="cursor-pointer border-b border-border/60 transition-colors hover:bg-muted/40 focus-within:bg-muted/40">
                <td className="px-6 py-2.5">
                  <Link to={rowUrl(row.id)} className="block rounded-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <span className="flex items-baseline gap-2">
                      {row.method && <GuardMethodLabel method={row.method} fixed size="md" />}
                      <span title={row.title} className={`min-w-0 truncate ${row.kind === 'operation' || row.kind === 'command' ? 'font-mono' : ''}`}>{row.title}</span>
                    </span>
                    <span title={row.hint} className="mt-0.5 block truncate text-[11px] text-muted-foreground">{row.hint}</span>
                  </Link>
                </td>
                <td className="px-3 py-2.5"><span className={CHIP_CLASS}>{guardDriver(row.surface)?.label ?? row.surface}</span></td>
                <td className="px-3 py-2.5 text-muted-foreground">{row.kind === 'entries' ? 'Entry points' : row.kind === 'screen' ? 'Screen' : row.kind === 'operation' ? 'Operation' : 'Command'}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{row.members.length}</td>
                <td className="px-3 py-2.5"><div className="flex flex-wrap gap-1">{catalogOrigins(row).map((origin) => <span key={origin} className={CHIP_CLASS}>{origin}</span>)}</div></td>
                <td className="px-6 py-2.5 text-right tabular-nums whitespace-nowrap">{catalogUsage(row)} {catalogUsage(row) === 1 ? 'test' : 'tests'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">
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
        {hidden.length > 0 && <p className="px-6 py-3 text-xs text-muted-foreground">{hidden.map((h) => h.text).join(' · ')}</p>}
      </div>
    </div>
  );
}
