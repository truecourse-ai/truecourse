/**
 * Dependencies: supplied resources users can configure, in the platform's index
 * table — the same resizable columns, and the same refusal to scroll sideways,
 * as every other list. Internal test resources are excluded by
 * useGuardDependencies. A row opens its own detail page. The search box is the
 * whole toolbar: State is a column, and one dimension does not earn a filter
 * row. How many there are is the TALLY at the bottom, by state, never a number
 * beside the title.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/dashboard/ui/bits';
import { IndexTable, type IndexColumn } from '@/dashboard/ui/index-table';
import { tallyOf } from '@/dashboard/ui/status-word';
import { useGuardDependencies } from '@/hooks/useGuardDependencies';
import {
  GUARD_DEPENDENCY_STATE,
  GUARD_DEPENDENCY_STATE_TONE,
  guardDependencyMatches,
  guardDependencyType,
} from '@/lib/guard-dependencies';
import type { GuardDependencyRow } from '@/types/guard-dependencies';
import type { Repo } from '@/dashboard/data/types';
import { useGuardTabJump } from './tab-jump';
import { useGuardRefresh } from './use-guard-refresh';

/** The states a dependency can be in, the to-do first: the tally's order. */
const STATES = ['unprovided', 'incomplete', 'provided'] as const;

const COLUMNS: IndexColumn<GuardDependencyRow>[] = [
  {
    key: 'name',
    label: 'Dependency',
    wrap: true,
    cell: (d) => (
      <span className="flex min-w-0 flex-col">
        <span className="block truncate text-foreground" title={d.name}>{d.name}</span>
        <span className="block truncate text-[11px] text-muted-foreground" title={d.summary}>
          {d.summary}
        </span>
      </span>
    ),
  },
  {
    key: 'type',
    label: 'Type',
    width: '9rem',
    className: 'text-muted-foreground',
    cell: (d) => guardDependencyType(d)?.label ?? '',
  },
  {
    key: 'state',
    label: 'State',
    width: '10rem',
    cell: (d) => {
      const state = d.state ? GUARD_DEPENDENCY_STATE[d.state] : null;
      return state ? (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-medium text-foreground">
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${state.dot}`} />
          {state.label}
        </span>
      ) : null;
    },
  },
  {
    key: 'usedBy',
    label: 'Used by',
    width: '7rem',
    align: 'right',
    className: 'text-foreground',
    cell: (d) => (d.usedBy > 0 ? d.usedBy : ''),
  },
];

export function DependenciesTab({ repo }: { repo: Repo }) {
  useGuardTabJump();
  const navigate = useNavigate();
  // A jump that names a dependency (`?dependency=`, a "Provide …" CTA) lands on
  // that dependency's page: the table is the index, the page is the dependency.
  const [params] = useSearchParams();
  const jumpTo = params.get('dependency');
  useEffect(() => {
    if (jumpTo) navigate(`/repos/${repo.id}/dependencies/${encodeURIComponent(jumpTo)}`, { replace: true });
  }, [jumpTo, navigate, repo.id]);

  const reloadKey = useGuardRefresh(repo, ['guard-setup', 'guard-externals', 'guard-generate', 'guard-run']);
  const { view, loading, error } = useGuardDependencies(repo.id, true, reloadKey);
  const [query, setQuery] = useState('');

  const all: GuardDependencyRow[] = useMemo(() => view?.dependencies ?? [], [view]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((d) => !q || guardDependencyMatches(d, q));
  }, [all, query]);

  const tally = useMemo(
    () =>
      tallyOf(
        rows,
        STATES,
        (d) => d.state ?? 'unprovided',
        (state) => ({
          word: GUARD_DEPENDENCY_STATE[state].label,
          tone: GUARD_DEPENDENCY_STATE_TONE[state],
        }),
      ),
    [rows],
  );

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <PageHeader title="Dependencies" />
      <IndexTable<GuardDependencyRow>
        label="Dependencies"
        rows={rows}
        rowId={(d) => d.name}
        columns={COLUMNS}
        onOpen={(d) => navigate(`/repos/${repo.id}/dependencies/${encodeURIComponent(d.name)}`)}
        query={query}
        onQuery={setQuery}
        searchPlaceholder="Search dependencies"
        tally={tally}
        total={all.length}
        empty={
          loading
            ? 'Loading dependencies.'
            : error
              ? error
              : all.length > 0
                ? 'No dependency matches.'
                : view?.detectionAvailable
                  ? 'No dependencies to configure.'
                  : 'Run setup to discover dependencies.'
        }
      />
    </div>
  );
}
