/**
 * Full-width catalog of screens, operations and commands, in the platform's
 * index table — the same resizable columns, and the same refusal to scroll
 * sideways, as every other list. Rows open their own detail page. The toolbar
 * is the platform's too: the search box across the top, then ONE Add-filter row
 * over both dimensions, never a chip bar per dimension. What the catalog holds
 * is the TALLY at the bottom, by kind, never a number beside the title.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { GuardInterfaceRow, GuardInterfacesView } from '@truecourse/shared';
import { guardDriver } from '@truecourse/shared';
import { GuardMethodLabel } from '@/components/guard/GuardMethodLabel';
import { useGuardFlows } from '@/hooks/useGuardFlows';
import { catalogOrigins, catalogUsage, interfaceCatalog } from './interface-catalog';
import { CHIP_CLASS, PageHeader } from '@/dashboard/ui/bits';
import { selectedValues, type FilterDimension } from '@/dashboard/ui/filter-builder';
import { facetDimensions } from '@/dashboard/ui/filter-facets';
import { IndexTable, type IndexColumn } from '@/dashboard/ui/index-table';
import { tallyOf } from '@/dashboard/ui/status-word';
import type { CatalogRow } from './interface-catalog';
import { useGuardInterfaces } from '@/hooks/useGuardInterfaces';
import type { Repo } from '@/dashboard/data/types';
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

/** The kinds a catalog row can be, in the order the tally lists them. */
const KINDS = ['screen', 'operation', 'command', 'entries'] as const;

const KIND_WORD: Record<(typeof KINDS)[number], string> = {
  screen: 'Screen',
  operation: 'Operation',
  command: 'Command',
  entries: 'Entry points',
};

export function InterfacesTab({ repo }: { repo: Repo }) {
  useGuardTabJump();
  const navigate = useNavigate();
  // A jump that names an interface (`?interface=`, from a test's interfaces) lands
  // on that interface's page: the table is the index, the page is the interface.
  const [params] = useSearchParams();
  const jumpTo = params.get('interface');
  useEffect(() => {
    if (jumpTo) navigate(`/repos/${repo.id}/interfaces/${encodeURIComponent(jumpTo)}`, { replace: true });
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

  const surfaces = useMemo(
    () =>
      [...new Set(all.map((i) => i.type))].map((key) => ({
        key,
        label: guardDriver(key)?.label ?? key,
      })),
    [all],
  );

  /**
   * The interfaces the search keeps: the members of every catalog row it
   * matches. The counts are of interfaces, the search is over the rows they
   * make up, so it reaches them through their membership.
   */
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === '') return null;
    return new Set(
      catalog.rows.filter((row) => row.search.includes(q)).flatMap((row) => row.members.map((m) => m.id)),
    );
  }, [catalog, query]);

  const dimensions: FilterDimension[] = useMemo(
    () =>
      facetDimensions<GuardInterfaceRow>({
        rows: all,
        selected: filters,
        ...(searched ? { matches: (i: GuardInterfaceRow) => searched.has(i.id) } : {}),
        dimensions: [
          {
            key: 'surface',
            label: 'Surface',
            valuesOf: (i) => [i.type],
            values: surfaces.map((s) => ({ value: s.key, label: s.label })),
          },
          {
            key: 'origin',
            label: 'Origin',
            valuesOf: (i) => [i.origin ?? 'derived'],
            values: (['derived', 'authored'] as const).map((origin) => ({
              value: origin,
              label: origin,
            })),
            hideEmpty: true,
          },
        ],
      }),
    [all, filters, searched, surfaces],
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
  const rowUrl = (id: string) => `/repos/${repo.id}/interfaces/${encodeURIComponent(id)}`;

  const tally = useMemo(
    () => tallyOf(rows, KINDS, (row) => row.kind, (kind) => ({ word: KIND_WORD[kind], tone: 'neutral' as const })),
    [rows],
  );

  const columns = useMemo<IndexColumn<CatalogRow>[]>(
    () => [
      {
        key: 'interface',
        label: 'Interface',
        wrap: true,
        cell: (row) => (
          <Link
            to={rowUrl(row.id)}
            className="block rounded-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span className="flex items-baseline gap-2">
              {row.method && <GuardMethodLabel method={row.method} fixed size="md" />}
              <span
                title={row.title}
                className={`min-w-0 truncate ${row.kind === 'operation' || row.kind === 'command' ? 'font-mono' : ''}`}
              >
                {row.title}
              </span>
            </span>
            <span title={row.hint} className="mt-0.5 block truncate text-[11px] text-muted-foreground">
              {row.hint}
            </span>
          </Link>
        ),
      },
      {
        key: 'surface',
        label: 'Surface',
        width: '7rem',
        cell: (row) => <span className={CHIP_CLASS}>{guardDriver(row.surface)?.label ?? row.surface}</span>,
      },
      {
        key: 'kind',
        label: 'Kind',
        width: '8rem',
        className: 'text-muted-foreground',
        cell: (row) => KIND_WORD[row.kind],
      },
      {
        key: 'members',
        label: 'Interfaces',
        width: '7rem',
        align: 'right',
        cell: (row) => row.members.length,
      },
      {
        key: 'origin',
        label: 'Origin',
        width: '8rem',
        wrap: true,
        cell: (row) => (
          <span className="flex flex-wrap gap-1">
            {catalogOrigins(row).map((origin) => (
              <span key={origin} className={CHIP_CLASS}>
                {origin}
              </span>
            ))}
          </span>
        ),
      },
      {
        key: 'usedBy',
        label: 'Used by',
        width: '7rem',
        align: 'right',
        className: 'whitespace-nowrap',
        cell: (row) => `${catalogUsage(row)} ${catalogUsage(row) === 1 ? 'test' : 'tests'}`,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [repo.id],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Interfaces" />
      <IndexTable<CatalogRow>
        label="Interfaces"
        rows={rows}
        rowId={(row) => row.id}
        columns={columns}
        onOpen={(row) => navigate(rowUrl(row.id))}
        query={query}
        onQuery={setQuery}
        searchPlaceholder="Search interfaces"
        dimensions={dimensions}
        selected={filters}
        onSelect={setFilters}
        filterAriaLabel="Filter interfaces"
        tally={tally}
        belowFilters={
          flows.view?.recipe && (
            <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-6 py-2 text-xs">
              <span className="text-muted-foreground">Preparation</span>
              {surfaces
                .filter((s) => surfaceFilter.length === 0 || surfaceFilter.includes(s.key))
                .map((s) => (
                  <Link
                    key={s.key}
                    to={rowUrl(`recipe:${s.key}`)}
                    className="rounded-sm text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    {s.label} recipe
                  </Link>
                ))}
            </div>
          )
        }
        belowTable={
          hidden.length > 0 && (
            <p className="px-6 py-3 text-xs text-muted-foreground">{hidden.map((h) => h.text).join(' \u00b7 ')}</p>
          )
        }
        empty={
          interfaces.loading
            ? 'Loading interfaces.'
            : interfaces.error
              ? interfaces.error
              : all.length === 0
                ? emptyCatalogReason(interfaces.view)
                : 'No interface matches.'
        }
      />
    </div>
  );
}
