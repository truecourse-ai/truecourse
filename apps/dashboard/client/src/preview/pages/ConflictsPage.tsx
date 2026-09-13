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
import { buildCorpusConflicts } from '@truecourse/shared';
import { getContextCorpus, type SpecCorpusResponse } from '@/lib/api';
import { IndexTable } from '@/preview/ui/index-table';
import {
  filterKey,
  parseFilterKey,
  selectedValues,
  type FilterDimension,
} from '@/preview/ui/filter-builder';
import { facetDimensions } from '@/preview/ui/filter-facets';
import { StatusWord, tallyOf, type StatusTone } from '@/preview/ui/status-word';
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

/** A conflict's state, open first: the order the filter offers and the tally counts in. */
const STATUS_VALUES = ['open', 'resolved'] as const;
type ConflictStatus = (typeof STATUS_VALUES)[number];

const STATUS_WORD: Record<ConflictStatus, string> = { open: 'Open', resolved: 'Resolved' };
const STATUS_TONE: Record<ConflictStatus, StatusTone> = { open: 'blocked', resolved: 'success' };

const statusOf = (row: ConflictRow): ConflictStatus => (row.resolved ? 'resolved' : 'open');

function valueOf(row: ConflictRow, dimension: Dimension): string {
  return dimension === 'status' ? statusOf(row) : row.area;
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

  const matchesQuery = useCallback(
    (row: ConflictRow) => {
      const q = query.trim().toLowerCase();
      return q === '' || row.title.toLowerCase().includes(q);
    },
    [query],
  );

  const dimensions = useMemo<FilterDimension[]>(() => {
    const areas = [...new Set(all.map((row) => row.area))].sort((a, b) => a.localeCompare(b));
    return facetDimensions<ConflictRow>({
      rows: all,
      selected,
      matches: matchesQuery,
      dimensions: [
        {
          key: 'status',
          label: DIMENSION_WORD.status,
          valuesOf: (row) => [statusOf(row)],
          values: STATUS_VALUES.map((value) => ({ value, label: STATUS_WORD[value] })),
          hideEmpty: true,
        },
        {
          key: 'area',
          label: DIMENSION_WORD.area,
          valuesOf: (row) => [valueOf(row, 'area')],
          values: areas.map((area) => ({ value: area, label: area })),
        },
      ],
    });
  }, [all, matchesQuery, selected]);

  const rows = useMemo(
    () => all.filter((row) => matchesQuery(row) && keeps(row, selected)),
    [all, matchesQuery, selected],
  );

  const tally = useMemo(
    () =>
      tallyOf(rows, STATUS_VALUES, statusOf, (value) => ({
        word: STATUS_WORD[value],
        tone: STATUS_TONE[value],
      })),
    [rows],
  );

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
        tally={tally}
        total={all.length}
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
              <StatusWord tone={STATUS_TONE[statusOf(row)]} word={STATUS_WORD[statusOf(row)]} />
            ),
          },
        ]}
      />
    </ContextFrame>
  );
}
