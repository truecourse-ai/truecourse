/**
 * The Scenarios tab's LEFT PANEL — one FLAT, bad-news-first list: birth findings
 * first (rows asking for a decision), then the committed inventory. No block, doc,
 * or section grouping — a row is a compact status chip plus the human title, and
 * the doc › section context lives in the DETAIL pane a click opens. Search / doc /
 * status filters sit at the top (the status filter carries a "finding" option to
 * isolate them). Single-click previews a row in a transient main-pane tab,
 * double-click pins it; the scenario id demotes to small mono meta so a long slug
 * can never be a primary label or stretch the panel.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { HoverPopover } from '@/components/ui/hover-popover';
import { guardRowStatus } from '@/hooks/useGuardScenarios';
import {
  guardListRowStatus,
  guardListStatusLabel,
  type GuardAutoResolvedRowData,
  type GuardListRow,
  type GuardListStatus,
} from '@/lib/guard-list-rows';
import { GuardStatusBadge } from './GuardStatusBadge';
import { GuardFindingBadge } from './GuardFindingBadge';

const SELECT =
  'rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

// Rows sit flush at the house `px-3` edge, like the Runs list (GuardDriftList).
const ROW =
  'flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-3 py-2 text-left transition-colors';

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
        <GuardStatusBadge status={guardRowStatus(row)} compact className="shrink-0" />
        {row.handWritten && (
          <HoverPopover content="Hand-written scenario — no manifest section authored it.">
            <span className="shrink-0 rounded bg-muted px-1 py-0 text-[9px] font-medium text-muted-foreground">
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
      title={
        row.dismissed
          ? `${row.title} — dismissed; takes effect next generate`
          : `${row.title} — birth finding; click to preview, double-click to pin`
      }
      className={`${ROW} ${active ? 'bg-primary/10' : 'hover:bg-muted/40'}`}
    >
      <div className="flex w-full items-center gap-2">
        <GuardFindingBadge compact />
        {/* Dismissed: the report is a snapshot, so the row lingers until the next
            generate — mark it so the state is legible (severity, not "removed"). */}
        {row.dismissed && (
          <span className="shrink-0 rounded bg-zinc-400/15 px-1 py-0 text-[9px] font-medium text-zinc-600 dark:text-zinc-400">
            dismissed
          </span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground">step {row.finding.step}</span>
      </div>
      <span
        className={`w-full truncate text-[13px] leading-snug ${
          row.dismissed ? 'text-muted-foreground line-through' : 'text-foreground'
        }`}
      >
        {row.title}
      </span>
    </button>
  );
}

/**
 * The collapsed "auto-resolved" ledger group at the bottom of the list (items 13 +
 * 14): high-confidence machine judgments the tool handled itself — weak scenarios
 * re-authored, `environment` claims dismissed, `generation-defect` findings retired to
 * re-attempt. Muted, with a count in the header; expanding shows each entry's title
 * (struck through), the action badge, and the one-line reason. Informational — no
 * selection.
 */
function AutoResolvedGroup({ rows }: { rows: GuardAutoResolvedRowData[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-border/60 bg-muted/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[11px] font-medium text-muted-foreground hover:bg-muted/40"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span>Auto-resolved</span>
        <span className="rounded bg-muted px-1.5 py-0 text-[10px] font-medium text-muted-foreground">{rows.length}</span>
        <span className="ml-auto truncate text-[10px] font-normal text-muted-foreground/80">
          handled without a task
        </span>
      </button>
      {open && (
        <ul role="list" aria-label="Auto-resolved scenarios">
          {rows.map((row) => (
            <li key={row.id} className="border-t border-border/40 px-3 py-1.5 pl-8">
              <div className="flex w-full items-center gap-2">
                <span className="min-w-0 truncate text-[12px] text-muted-foreground line-through">{row.title}</span>
                <span className={`ml-auto shrink-0 text-[10px] ${row.badge.tone}`}>{row.badge.label}</span>
              </div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/80">{row.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GuardScenariosPanel({
  rows,
  autoResolved = [],
  loading,
  error,
  activeId,
  onOpen,
  prRef,
  scenariosCommit,
}: {
  rows: GuardListRow[];
  /** The run's auto-resolved ledger (item 13) — rendered as a collapsed bottom group. */
  autoResolved?: GuardAutoResolvedRowData[];
  loading: boolean;
  error: string | null;
  activeId: string | null;
  /** Single-click preview (transient tab), double-click pin — the shared tab model. */
  onOpen: (id: string, pinned: boolean) => void;
  /** The PR head ref scoping this view (EE PR view); undefined at repo level. */
  prRef?: string | null;
  /** The commit the inventory was read at (hosted); the SpecCorpusView `corpusCommit` analog. */
  scenariosCommit?: string | null;
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

  // Bad-news-first ordering: findings → committed scenarios.
  const findingRows = useMemo(() => visible.filter((r) => r.kind === 'finding'), [visible]);
  const scenarioRows = useMemo(() => visible.filter((r) => r.kind === 'scenario'), [visible]);

  // Split counts for the honest "N of M scenarios · K findings" line.
  const totalScenarios = useMemo(() => rows.filter((r) => r.kind === 'scenario').length, [rows]);
  const totalFindings = useMemo(() => rows.filter((r) => r.kind === 'finding').length, [rows]);
  const visScenarios = scenarioRows.length;
  const visFindings = findingRows.length;

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
  if (rows.length === 0 && autoResolved.length === 0) {
    // The MAIN pane carries the single CTA empty state — here the left panel stays
    // quiet (one muted line) so two identical cards never sit side by side.
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-center text-xs text-muted-foreground">No scenarios yet.</p>
      </div>
    );
  }

  // PR view whose inventory fell back to the baseline set — the gate ran the
  // baseline scenarios against the head without re-persisting them (the
  // SpecCorpusView baseline-fallback idiom).
  const baselineFallback = !!prRef && !!scenariosCommit && scenariosCommit !== prRef;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {baselineFallback && (
        <div className="shrink-0 border-b border-border bg-card/40 px-3 py-1.5 text-[11px] text-muted-foreground">
          Showing the baseline scenarios — this PR didn&apos;t regenerate them.
        </div>
      )}
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
                {d}
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

      {/* One flat, bad-news-first list: findings → committed scenarios, then the
          collapsed auto-resolved ledger pinned to the bottom. */}
      <div className="flex-1 overflow-auto">
        {visible.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            No scenarios match these filters.
          </div>
        ) : (
          <div role="list" aria-label="Scenario inventory">
            {findingRows.map((row) => (
              <FindingRow key={row.id} row={row} active={activeId === row.id} onOpen={onOpen} />
            ))}
            {scenarioRows.map((row) => (
              <ScenarioRow key={row.id} row={row} active={activeId === row.id} onOpen={onOpen} />
            ))}
          </div>
        )}
        {autoResolved.length > 0 && <AutoResolvedGroup rows={autoResolved} />}
      </div>
    </div>
  );
}
