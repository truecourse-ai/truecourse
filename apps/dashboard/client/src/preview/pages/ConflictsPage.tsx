/**
 * Context › Conflicts: every conflict the scan found between two documents'
 * sections, open first. A conflict is a property of the WORKSPACE's documents,
 * not of a repository, so it is listed once and settled once — and the verdict
 * rides into every repository that reads them.
 *
 * The rows are derived from the workspace corpus exactly as the coverage
 * sidebar derives them (`buildCorpusConflicts` over the corpus and its
 * resolutions), so a row here and the resolver it opens can never disagree
 * about what is settled.
 */

import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { buildCorpusConflicts } from '@/preview/vendor/shared';
import { getContextCorpus, type SpecCorpusResponse } from '@/lib/api';
import { IndexTable } from '@/preview/ui/index-table';
import {
  filterKey,
  parseFilterKey,
  selectedValues,
  type FilterDimension,
} from '@/preview/ui/filter-builder';
import { StatusWord } from '@/preview/ui/status-word';
import { useContextSignal } from '@/preview/shell/use-context';
import { useEffect, useRef } from 'react';
import { ContextFrame } from './ContextFrame';
import { conflictHref } from './context-hrefs';

const DIMENSIONS = ['status', 'area'] as const;
type Dimension = (typeof DIMENSIONS)[number];
const DIMENSION_WORD: Record<Dimension, string> = { status: 'Status', area: 'Area' };
const isDimension = (key: string): key is Dimension =>
  (DIMENSIONS as readonly string[]).includes(key);

/** One conflict as the table reads it. */
export interface ConflictRow {
  id: string;
  title: string;
  area: string;
  resolved: boolean;
}

function valueOf(row: ConflictRow, dimension: Dimension): string {
  return dimension === 'status' ? (row.resolved ? 'resolved' : 'open') : row.area;
}

function keeps(row: ConflictRow, selected: readonly string[]): boolean {
  for (const dimension of DIMENSIONS) {
    const wanted = selectedValues(selected, dimension);
    if (wanted.length > 0 && !wanted.includes(valueOf(row, dimension))) return false;
  }
  return true;
}

/** The workspace corpus, re-read whenever its context or its decisions move. */
export function useWorkspaceCorpus(signal: number): {
  data: SpecCorpusResponse | null;
  loaded: boolean;
  error: string | null;
  refetch: () => Promise<void>;
} {
  const [data, setData] = useState<SpecCorpusResponse | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refetch = useCallback(async () => {
    try {
      const res = await getContextCorpus();
      if (!alive.current) return;
      setData(res);
      setError(null);
    } catch (e) {
      if (!alive.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch, signal]);

  return { data, loaded, error, refetch };
}

/** Every conflict of a corpus payload, open first, then by title. */
export function conflictRows(data: SpecCorpusResponse | null): ConflictRow[] {
  if (!data) return [];
  return buildCorpusConflicts(data.corpus, {
    manualExcludes: data.manualExcludes ?? [],
    conflictResolutions: data.conflictResolutions ?? [],
  })
    .map((conflict) => ({
      id: conflict.id,
      title: conflict.note || `${conflict.a} and ${conflict.b}`,
      area: conflict.area,
      resolved: conflict.resolved,
    }))
    .sort((a, b) => Number(a.resolved) - Number(b.resolved) || a.title.localeCompare(b.title));
}

export default function ConflictsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const signal = useContextSignal();
  const { data, loaded, error } = useWorkspaceCorpus(signal);
  const [query, setQuery] = useState('');

  const all = useMemo(() => conflictRows(data), [data]);

  const selected = useMemo(
    () =>
      DIMENSIONS.flatMap((dimension) =>
        searchParams
          .getAll(dimension)
          .filter(Boolean)
          .map((value) => filterKey(dimension, value)),
      ),
    [searchParams],
  );

  const select = useCallback(
    (next: string[]) => {
      const params = new URLSearchParams(searchParams);
      for (const dimension of DIMENSIONS) params.delete(dimension);
      for (const key of next) {
        const parsed = parseFilterKey(key);
        if (parsed && isDimension(parsed.dimension)) params.append(parsed.dimension, parsed.value);
      }
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const dimensions = useMemo<FilterDimension[]>(() => {
    const count = (dimension: Dimension, value: string) =>
      all.filter((row) => valueOf(row, dimension) === value).length;
    const areas = [...new Set(all.map((row) => row.area))].sort((a, b) => a.localeCompare(b));
    return [
      {
        key: 'status',
        label: DIMENSION_WORD.status,
        options: [
          { key: filterKey('status', 'open'), label: 'Open', count: count('status', 'open') },
          {
            key: filterKey('status', 'resolved'),
            label: 'Resolved',
            count: count('status', 'resolved'),
          },
        ].filter((option) => option.count > 0),
      },
      {
        key: 'area',
        label: DIMENSION_WORD.area,
        options: areas.map((area) => ({
          key: filterKey('area', area),
          label: area,
          count: count('area', area),
        })),
      },
    ];
  }, [all]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((row) => (!q || row.title.toLowerCase().includes(q)) && keeps(row, selected));
  }, [all, query, selected]);

  const empty = !loaded
    ? 'Loading…'
    : error
      ? `The conflicts could not be read: ${error}`
      : all.length === 0
        ? 'No conflict between any two documents.'
        : 'No conflict matches.';

  return (
    <ContextFrame section="conflicts" signal={signal} crumbs={[{ label: 'Conflicts' }]}>
      <IndexTable<ConflictRow>
        label="Conflicts"
        rows={rows}
        rowId={(row) => row.id}
        onOpen={(row) => navigate(conflictHref(row.id))}
        query={query}
        onQuery={setQuery}
        searchPlaceholder="Search conflicts"
        dimensions={dimensions}
        selected={selected}
        onSelect={select}
        filterAriaLabel="Filter conflicts"
        empty={empty}
        columns={[
          {
            key: 'title',
            label: 'Conflict',
            cell: (row) => <span className="text-foreground">{row.title}</span>,
          },
          { key: 'area', label: 'Area', width: '14rem', className: 'text-muted-foreground', cell: (row) => row.area },
          {
            key: 'status',
            label: 'Status',
            width: '8rem',
            cell: (row) => (
              <StatusWord
                tone={row.resolved ? 'success' : 'blocked'}
                word={row.resolved ? 'Resolved' : 'Open'}
              />
            ),
          },
        ]}
      />
    </ContextFrame>
  );
}
