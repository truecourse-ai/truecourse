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
 * Search + a plain status filter sit on top — the same four words the Flows tab
 * filters by. Single-click previews a row in the main pane, double-click pins it.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, Loader2, PenLine } from 'lucide-react';
import { useScrollToSelected } from '@/hooks/useScrollToSelected';
import {
  GUARD_FLOW_STATUS_ORDER,
  GUARD_FLOW_STATUS_WORD,
  type GuardFlowPlainStatus,
} from '@/lib/guard-flow-status';
import { guardTestLabel, type GuardTestRow } from '@/lib/guard-tests';
import { HoverPopover } from '@/components/ui/hover-popover';
import { GuardFlowStatusChip } from './GuardStatusBadge';

const SELECT =
  'rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

const ROW =
  'flex w-full min-w-0 flex-col items-start gap-1 border-b border-border/60 px-3 py-2 text-left transition-colors';

function TestRow({
  row,
  active,
  onOpen,
  rowRef,
}: {
  row: GuardTestRow;
  active: boolean;
  onOpen: (id: string, pinned: boolean) => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div ref={rowRef} role="listitem" className={`${ROW} ${active ? 'bg-primary/10' : 'hover:bg-muted/40'}`}>
      <button
        type="button"
        onClick={() => onOpen(row.id, false)}
        onDoubleClick={() => onOpen(row.id, true)}
        className="flex w-full min-w-0 flex-col items-start gap-1 text-left"
      >
        <div className="flex w-full min-w-0 flex-wrap items-center gap-1">
          <span className="text-[11px] font-medium text-muted-foreground">{guardTestLabel(row.surface)}</span>
          <span className="text-[11px] text-muted-foreground">·</span>
          <GuardFlowStatusChip status={row.status.plain} word={row.status.word} />
          {row.handWritten && (
            <HoverPopover content="Hand-written — no generate authored it.">
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <PenLine className="h-3 w-3" />
                hand-written
              </span>
            </HoverPopover>
          )}
        </div>
        <span className="w-full truncate text-[13px] font-normal leading-snug text-foreground">{row.title}</span>
      </button>
    </div>
  );
}

export function GuardTestsPanel({
  tests,
  loading,
  error,
  activeId,
  onOpen,
  prRef,
  testsCommit,
}: {
  tests: GuardTestRow[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  /** Single-click preview (transient tab), double-click pin — the shared tab model. */
  onOpen: (id: string, pinned: boolean) => void;
  /** The PR head ref scoping this view (EE PR view); undefined at repo level. */
  prRef?: string | null;
  /** The commit the inventory was read at (hosted) — the baseline-fallback label. */
  testsCommit?: string | null;
}) {
  const [status, setStatus] = useState<GuardFlowPlainStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  const counts = useMemo(() => {
    const out = { failing: 0, blocked: 0, ungenerated: 0, passing: 0 };
    for (const t of tests) out[t.status.plain] += 1;
    return out;
  }, [tests]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tests.filter((t) => {
      if (status !== 'all' && t.status.plain !== status) return false;
      if (!q) return true;
      return `${t.title} ${t.id} ${t.flowTitle} ${t.doc}`.toLowerCase().includes(q);
    });
  }, [tests, status, search]);

  // A selection that arrived with the view (a `?gtest=` deep link from a flow or
  // a run) is off-screen in a long list — bring the row to the user. Same
  // mechanism in every guard panel.
  const rows = useScrollToSelected<HTMLDivElement>(activeId, [visible]);

  if (loading && tests.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error && tests.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <span>{error}</span>
      </div>
    );
  }
  if (tests.length === 0) {
    // The MAIN pane carries the single CTA empty state — the panel stays quiet so
    // two identical cards never sit side by side.
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-center text-xs text-muted-foreground">No tests yet.</p>
      </div>
    );
  }

  const baselineFallback = !!prRef && !!testsCommit && testsCommit !== prRef;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {baselineFallback && (
        <div className="shrink-0 border-b border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          Showing the baseline tests — this PR didn&apos;t regenerate them.
        </div>
      )}

      <div className="shrink-0 space-y-2 border-b border-border p-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search tests…"
          aria-label="Search tests"
          className={`${SELECT} w-full`}
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as GuardFlowPlainStatus | 'all')}
          aria-label="Filter by status"
          className={`${SELECT} w-full`}
        >
          <option value="all">All tests</option>
          {GUARD_FLOW_STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {GUARD_FLOW_STATUS_WORD[s]} ({counts[s]})
            </option>
          ))}
        </select>
        <div className="text-[11px] text-muted-foreground">
          {visible.length} of {tests.length} test{tests.length === 1 ? '' : 's'}
        </div>
      </div>

      {/* The list scrolls DOWN only: a row's lines all truncate, so nothing needs
          sideways scroll and the panel must not offer it. */}
      {visible.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">No tests match these filters.</div>
      ) : (
        <div
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
          role="list"
          aria-label="Test inventory"
        >
          {visible.map((row) => (
            <TestRow
              key={row.id}
              row={row}
              active={activeId === row.id}
              onOpen={onOpen}
              rowRef={rows.set(row.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
