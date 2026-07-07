/**
 * The Scenarios tab's LEFT PANEL — the committed-scenario inventory AND birth
 * findings as one doc › section grouped list (the Contracts-panel analog). Every
 * generated / hand-written guard is a previewable row (last-run outcome badge +
 * title + id meta, hand-written rows chipped); every birth finding is a row too —
 * a distinct red "finding" chip, section-bound in the same grouping (a finding is
 * a candidate that failed to become a guard). Search / doc / status filters sit at
 * the top; the status filter gains a "finding" option to isolate them. Single-click
 * previews a row in a transient main-pane tab, double-click pins it — the recipe
 * card and "last generate" strip live in the main pane's overview, not here.
 *
 * Group headers show the section's HUMAN heading text (joined onto scenario rows
 * as `headingText`, reused by findings, else the slug leaf) — slugs are engine
 * identifiers, never UI copy. The row PRIMARY text is always the human title
 * (truncated); the scenario id demotes to small mono meta so a long slug id can
 * never be a primary label or stretch the panel. Both grouping levels use the
 * sticky-header idiom with rows indented under their section header.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, FileCode2, FileText, Loader2 } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import { docBasename, sectionLeaf } from '@/lib/guard-drifts';
import { guardRowStatus } from '@/hooks/useGuardScenarios';
import {
  guardListRowStatus,
  guardListStatusLabel,
  type GuardListRow,
  type GuardListStatus,
} from '@/lib/guard-list-rows';
import { GuardStatusBadge } from './GuardStatusBadge';
import { GuardFindingBadge } from './GuardFindingBadge';

const SELECT =
  'rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

// Rows sit at the house nested-list depth (SpecCorpusView rows use `pl-7`), a
// modest indent under the `pl-5` section header so they read as belonging to it —
// not a column pushed far right.
const ROW =
  'flex w-full flex-col items-start gap-0.5 border-b border-border/60 py-2 pl-7 pr-3 text-left transition-colors';

function ScenarioRow({
  row,
  active,
  onOpen,
}: {
  row: Extract<GuardListRow, { kind: 'scenario' }>;
  active: boolean;
  onOpen: (id: string, pinned: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="listitem"
      onClick={() => onOpen(row.id, false)}
      onDoubleClick={() => onOpen(row.id, true)}
      title={`${row.title} (${row.id}) — click to preview, double-click to pin`}
      className={`${ROW} ${active ? 'bg-primary/10' : 'hover:bg-muted/40'}`}
    >
      <div className="flex w-full items-center gap-2">
        <GuardStatusBadge status={guardRowStatus(row)} className="shrink-0" />
        {row.handWritten && (
          <HoverPopover content="Hand-written scenario — no manifest section authored it.">
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              hand-written
            </span>
          </HoverPopover>
        )}
        <span className="ml-auto min-w-0 truncate font-mono text-[11px] text-muted-foreground">{row.id}</span>
      </div>
      <span className="w-full truncate text-[13px] leading-snug text-foreground">{row.title}</span>
    </button>
  );
}

function FindingRow({
  row,
  active,
  onOpen,
}: {
  row: Extract<GuardListRow, { kind: 'finding' }>;
  active: boolean;
  onOpen: (id: string, pinned: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="listitem"
      onClick={() => onOpen(row.id, false)}
      onDoubleClick={() => onOpen(row.id, true)}
      title={`${row.title} — birth finding; click to preview, double-click to pin`}
      className={`${ROW} ${active ? 'bg-primary/10' : 'hover:bg-muted/40'}`}
    >
      <div className="flex w-full items-center gap-2">
        <GuardFindingBadge />
        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">step {row.finding.step}</span>
      </div>
      <span className="w-full truncate text-[13px] leading-snug text-foreground">{row.title}</span>
    </button>
  );
}

export function GuardScenariosPanel({
  rows,
  loading,
  error,
  activeId,
  onOpen,
}: {
  rows: GuardListRow[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  /** Single-click preview (transient tab), double-click pin — the shared tab model. */
  onOpen: (id: string, pinned: boolean) => void;
}) {
  const [docFilter, setDocFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const docs = useMemo(() => [...new Set(rows.map((r) => r.doc))].sort(), [rows]);
  const statuses = useMemo(
    () => [...new Set(rows.map(guardListRowStatus))].sort() as GuardListStatus[],
    [rows],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (docFilter !== 'all' && r.doc !== docFilter) return false;
      if (statusFilter !== 'all' && guardListRowStatus(r) !== statusFilter) return false;
      // Search matches the human fields; the scenario id joins only for scenario
      // rows (a finding's synthetic key is never user-facing search fodder).
      const hay =
        r.kind === 'scenario'
          ? `${r.id} ${r.title} ${r.anchor} ${r.doc} ${r.headingText ?? ''}`
          : `${r.title} ${r.anchor} ${r.doc} ${r.headingText ?? ''}`;
      if (q && !hay.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, docFilter, statusFilter, search]);

  // doc › section grouping, in first-seen order (scenarios before findings).
  const groups = useMemo(() => {
    const byDoc = new Map<string, Map<string, GuardListRow[]>>();
    for (const r of visible) {
      const sections = byDoc.get(r.doc) ?? new Map<string, GuardListRow[]>();
      const list = sections.get(r.anchor) ?? [];
      list.push(r);
      sections.set(r.anchor, list);
      byDoc.set(r.doc, sections);
    }
    return byDoc;
  }, [visible]);

  // Split counts for the honest "N of M scenarios · K findings" line.
  const totalScenarios = useMemo(() => rows.filter((r) => r.kind === 'scenario').length, [rows]);
  const totalFindings = rows.length - totalScenarios;
  const visScenarios = visible.filter((r) => r.kind === 'scenario').length;
  const visFindings = visible.length - visScenarios;

  if (loading && rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error && rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <span>{error}</span>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={FileCode2}
        title="No scenarios yet"
        body={
          <>
            Run <code className="rounded bg-muted px-1 py-0.5 text-xs">truecourse guard generate</code> to author
            scenarios, or commit hand-written ones under{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">.truecourse/scenarios/</code>.
          </>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Filter bar */}
      <div className="shrink-0 space-y-2 border-b border-border p-2">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search scenarios…"
          aria-label="Search scenarios"
          className={`${SELECT} w-full`}
        />
        <div className="flex gap-2">
          <select
            value={docFilter}
            onChange={(e) => setDocFilter(e.target.value)}
            aria-label="Filter by document"
            className={`${SELECT} min-w-0 flex-1`}
          >
            <option value="all">All documents</option>
            {docs.map((d) => (
              <option key={d} value={d}>
                {docBasename(d)}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label="Filter by status"
            className={`${SELECT} min-w-0 flex-1`}
          >
            <option value="all">All statuses</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {guardListStatusLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="text-[11px] text-muted-foreground">
          {visScenarios} of {totalScenarios} scenario{totalScenarios === 1 ? '' : 's'}
          {totalFindings > 0 && (
            <>
              {' · '}
              {visFindings} finding{visFindings === 1 ? '' : 's'}
            </>
          )}
        </div>
      </div>

      {/* doc › section grouped inventory */}
      {visible.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          No scenarios match these filters.
        </div>
      ) : (
        <div className="flex-1 overflow-auto" role="list" aria-label="Scenario inventory">
          {[...groups.entries()].map(([doc, sections]) => (
            <div key={doc}>
              {/* Doc-level header — sticks above its sections while they scroll. */}
              <div className="sticky top-0 z-20 flex h-7 items-center gap-1.5 border-b border-border bg-card px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <FileText className="h-3 w-3 shrink-0" />
                <span className="min-w-0 truncate" title={doc}>
                  {docBasename(doc)}
                </span>
                <span className="ml-auto shrink-0">
                  {[...sections.values()].reduce((n, list) => n + list.length, 0)}
                </span>
              </div>
              {[...sections.entries()].map(([anchor, list]) => (
                <div key={anchor}>
                  {/* Section header — the HUMAN heading text, sticky just below
                      the doc header (GuardDriftList idiom: solid wrapper, tinted
                      inner row) with its rows indented beneath it. */}
                  <div className="sticky top-7 z-10 bg-card" title={anchor}>
                    <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 py-1 pl-5 pr-3 text-[11px] font-medium text-foreground">
                      <span className="min-w-0 truncate">{list[0].headingText ?? sectionLeaf(anchor)}</span>
                      <span className="shrink-0 text-[10px] text-muted-foreground">{list.length}</span>
                    </div>
                  </div>
                  {list.map((row) =>
                    row.kind === 'finding' ? (
                      <FindingRow key={row.id} row={row} active={activeId === row.id} onOpen={onOpen} />
                    ) : (
                      <ScenarioRow key={row.id} row={row} active={activeId === row.id} onOpen={onOpen} />
                    ),
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
