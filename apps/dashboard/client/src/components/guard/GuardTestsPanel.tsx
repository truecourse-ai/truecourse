/**
 * The Tests tab's LEFT PANEL — every committed test as one entity row, failing
 * tests first (severity-led). A flow either has a test or it doesn't; this list is
 * the tests themselves, and each row says what it is at a glance:
 *
 *   CLI test · Failing (birth)
 *   Tasks are created, listed newest-first, completed and filterable
 *
 * The lead line names the surface and the ONE status word; the second line is the
 * test's own title. Nothing else: the flow a test belongs to is a second click
 * target that navigates away from the list, so it lives in the test DETAIL only.
 *
 * Search and the status filter chips are the shared {@link EntityList}'s — the
 * same chips the Flows tab offers, over the SAME filter state the overview's stat
 * chips set, so a chip and this bar can never disagree.
 */

import { useMemo } from 'react';
import { EntityList, type FilterOption } from '@/components/ui/entity-list';
import {
  guardTestFilterCounts,
  guardTestMatchesFilter,
  type GuardTestFilter,
  type GuardTestRow,
} from '@/lib/guard-tests';
import { GuardTestListRow } from './GuardTestListRow';

export function GuardTestsPanel({
  tests,
  loading,
  error,
  activeId,
  filter,
  onFilter,
  onOpen,
  prRef,
  testsCommit,
}: {
  tests: GuardTestRow[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  /** The status filter, owned above so the overview's chips set the same one. */
  filter: GuardTestFilter;
  onFilter: (filter: GuardTestFilter) => void;
  /** Single-click preview (transient tab), double-click pin — the shared tab model. */
  onOpen: (id: string, pinned: boolean) => void;
  /** The PR head ref scoping this view (EE PR view); undefined at repo level. */
  prRef?: string | null;
  /** The commit the inventory was read at (hosted) — the baseline-fallback label. */
  testsCommit?: string | null;
}) {
  const options = useMemo<FilterOption[]>(
    () => guardTestFilterCounts(tests).map(({ key, label, count }) => ({ key, label, count })),
    [tests],
  );

  const baselineFallback = !!prRef && !!testsCommit && testsCommit !== prRef;

  return (
    <EntityList<GuardTestRow>
      label="Test inventory"
      items={tests}
      itemId={(t) => t.id}
      activeId={activeId}
      onOpen={onOpen}
      loading={loading}
      error={error}
      search={{
        placeholder: 'Search tests…',
        ariaLabel: 'Search tests',
        match: (t, q) => `${t.title} ${t.id} ${t.flowTitle} ${t.doc}`.toLowerCase().includes(q),
      }}
      filter={{
        label: 'Status',
        ariaLabel: 'Filter by status',
        options,
        selected: filter === 'all' ? [] : [filter],
        onChange: (next) => onFilter((next[0] as GuardTestFilter) ?? 'all'),
        match: (t, key) => guardTestMatchesFilter(t, key as GuardTestFilter),
      }}
      noun={{ one: 'test', many: 'tests' }}
      renderRow={(row) => <GuardTestListRow row={row} />}
      noMatch="No tests match these filters."
      // The MAIN pane carries the single CTA empty state — the panel stays quiet so
      // two identical cards never sit side by side.
      emptyText="No tests yet."
      banner={
        baselineFallback ? (
          <div className="shrink-0 border-b border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground">
            Showing the baseline tests — this PR didn&apos;t regenerate them.
          </div>
        ) : null
      }
    />
  );
}
