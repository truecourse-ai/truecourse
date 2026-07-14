/**
 * The Scenarios tab's LEFT PANEL — the committed-scenario inventory AND birth
 * findings AND ready-but-held scenarios. Bad-news-first (the Runs view idiom): a
 * red-tinted "Findings" block floats to the TOP (rows asking for a decision), then
 * an amber "Held" block (birth-passed scenarios an unsettled section withheld —
 * limbo, not error), then the committed scenarios in a neutral "Scenarios" block.
 * When no findings or held rows are visible those blocks and the "Scenarios" label
 * all drop and the list reads as one plain doc › section inventory. Inside each
 * block, rows group doc › section: every generated / hand-written guard is a
 * previewable row (last-run outcome badge + title + id meta, hand-written rows
 * chipped); every birth finding is a row with a distinct red "finding" chip (a
 * candidate that failed to become a guard, carrying its blast-radius "holds N" when
 * its section holds ready work); every held scenario is a row with an amber "held"
 * chip. Search / doc / status filters sit at the top; the status filter gains
 * "finding" and "held" options to isolate them. Single-click previews a row in a
 * transient main-pane tab, double-click pins it — the recipe card and "last
 * generate" strip live in the main pane's overview, not here.
 *
 * Group headers show the section's HUMAN heading text (joined onto scenario rows
 * as `headingText`, reused by findings, else the slug leaf) — slugs are engine
 * identifiers, never UI copy. The row PRIMARY text is always the human title
 * (truncated); the scenario id demotes to small mono meta so a long slug id can
 * never be a primary label or stretch the panel. Block, doc, and section headers
 * all use the sticky-header idiom, stacked by z-index so a header never overlaps
 * the one above it while scrolling; rows sit flush beneath their section header.
 * Block headers (Findings / Scenarios) AND doc headers are collapsible per
 * Coverage's `Section` idiom (chevron, aria-expanded, default open) and
 * sticky-SOLID (bg-card base, any tint layered inside) so scrolling rows never
 * show through; section headers stay static — sections hold ~1-3 rows and a
 * chevron per near-empty group is noise.
 */

import { useMemo, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronRight, FileText, Loader2 } from 'lucide-react';
import { HoverPopover } from '@/components/ui/hover-popover';
import { sectionLeaf } from '@/lib/guard-drifts';
import { guardRowStatus } from '@/hooks/useGuardScenarios';
import {
  guardListRowStatus,
  guardListStatusLabel,
  type GuardListRow,
  type GuardListStatus,
} from '@/lib/guard-list-rows';
import { GuardStatusBadge } from './GuardStatusBadge';
import { GuardFindingBadge } from './GuardFindingBadge';
import { GuardHeldBadge } from './GuardHeldBadge';

const SELECT =
  'rounded border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary';

// Rows sit flush at the house `px-3` edge, like the Runs list (GuardDriftList)
// rows — hierarchy is carried by the tinted/uppercase headers, not indentation.
const ROW =
  'flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-3 py-2 text-left transition-colors';

/** doc › section grouping of a row set, in first-seen order. */
function groupByDocSection(rows: GuardListRow[]) {
  const byDoc = new Map<string, Map<string, GuardListRow[]>>();
  for (const r of rows) {
    const sections = byDoc.get(r.doc) ?? new Map<string, GuardListRow[]>();
    const list = sections.get(r.anchor) ?? [];
    list.push(r);
    sections.set(r.anchor, list);
    byDoc.set(r.doc, sections);
  }
  return byDoc;
}

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
      title={
        row.dismissed
          ? `${row.title} — dismissed; takes effect next generate`
          : `${row.title} — birth finding; click to preview, double-click to pin`
      }
      className={`${ROW} ${active ? 'bg-primary/10' : 'hover:bg-muted/40'}`}
    >
      <div className="flex w-full items-center gap-2">
        <GuardFindingBadge />
        {/* Dismissed: the report is a snapshot, so the row lingers until the next
            generate — mark it so the state is legible (severity, not "removed"). */}
        {row.dismissed && (
          <span className="shrink-0 rounded bg-zinc-400/15 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:text-zinc-400">
            dismissed
          </span>
        )}
        {/* Blast radius: this finding's section holds N birth-passed scenarios back. */}
        {!row.dismissed && row.heldCount > 0 && (
          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
            holds {row.heldCount}
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

function HeldRow({
  row,
  active,
  onOpen,
}: {
  row: Extract<GuardListRow, { kind: 'held' }>;
  active: boolean;
  onOpen: (id: string, pinned: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="listitem"
      onClick={() => onOpen(row.id, false)}
      onDoubleClick={() => onOpen(row.id, true)}
      title={`${row.title} — ready but held; click to preview, double-click to pin`}
      className={`${ROW} ${active ? 'bg-primary/10' : 'hover:bg-muted/40'}`}
    >
      <div className="flex w-full items-center gap-2">
        <GuardHeldBadge />
        <span className="ml-auto min-w-0 truncate font-mono text-[11px] text-muted-foreground">
          {row.ready.id}
        </span>
      </div>
      <span className="w-full truncate text-[13px] leading-snug text-foreground">{row.title}</span>
    </button>
  );
}

/**
 * One doc group — a collapsible sticky header (Coverage `Section` idiom: whole
 * header is the toggle, chevron, aria-expanded, default open; solid bg-card so
 * rows never show through) plus its STATIC section groups (sections hold ~1-3
 * rows — a chevron per near-empty group is noise, not control). Per-instance
 * open state keeps collapse independent per doc AND per block.
 */
function DocGroup({
  doc,
  sections,
  docTop,
  sectionTop,
  activeId,
  onOpen,
}: {
  doc: string;
  sections: Map<string, GuardListRow[]>;
  docTop: string;
  sectionTop: string;
  activeId: string | null;
  onOpen: (id: string, pinned: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`sticky ${docTop} z-20 flex h-7 w-full items-center gap-1.5 border-b border-border bg-card px-3 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground`}
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <FileText className="h-3 w-3 shrink-0" />
        <span className="min-w-0 truncate" title={doc}>
          {doc}
        </span>
        <span className="ml-auto shrink-0">
          {[...sections.values()].reduce((n, list) => n + list.length, 0)}
        </span>
      </button>
      {open &&
        [...sections.entries()].map(([anchor, list]) => (
          <div key={anchor}>
            {/* Section header — the HUMAN heading text, sticky just below the doc
                header (GuardDriftList idiom: solid wrapper, tinted inner row); its
                rows sit flush beneath it. */}
            <div className={`sticky ${sectionTop} z-10 bg-card`} title={anchor}>
              <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-1 text-[11px] font-medium text-foreground">
                <span className="min-w-0 truncate">{list[0].headingText ?? sectionLeaf(anchor)}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{list.length}</span>
              </div>
            </div>
            {list.map((row) =>
              row.kind === 'finding' ? (
                <FindingRow key={row.id} row={row} active={activeId === row.id} onOpen={onOpen} />
              ) : row.kind === 'held' ? (
                <HeldRow key={row.id} row={row} active={activeId === row.id} onOpen={onOpen} />
              ) : (
                <ScenarioRow key={row.id} row={row} active={activeId === row.id} onOpen={onOpen} />
              ),
            )}
          </div>
        ))}
    </div>
  );
}

/**
 * A block's doc › section grouped rows — shared by the findings and scenarios
 * blocks. `withBlockHeader` pushes the sticky doc/section offsets down by the
 * block-header height (h-7) so headers stack instead of overlapping; without a
 * block header the doc header sticks flush at the top like a lone list.
 */
function GroupedRows({
  groups,
  withBlockHeader,
  activeId,
  onOpen,
}: {
  groups: Map<string, Map<string, GuardListRow[]>>;
  withBlockHeader: boolean;
  activeId: string | null;
  onOpen: (id: string, pinned: boolean) => void;
}) {
  const docTop = withBlockHeader ? 'top-7' : 'top-0';
  const sectionTop = withBlockHeader ? 'top-14' : 'top-7';
  return (
    <>
      {[...groups.entries()].map(([doc, sections]) => (
        <DocGroup
          key={doc}
          doc={doc}
          sections={sections}
          docTop={docTop}
          sectionTop={sectionTop}
          activeId={activeId}
          onOpen={onOpen}
        />
      ))}
    </>
  );
}

/**
 * A collapsible block header (Findings / Scenarios) — Coverage's `Section` idiom
 * (chevron, aria-expanded, default open). Solid `bg-card` sticky WRAPPER so
 * scrolling rows never show through; the tint lives on the inner toggle button,
 * never on the sticky base.
 */
function BlockHeader({
  title,
  count,
  open,
  onToggle,
  tone,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  tone: string;
}) {
  return (
    <div className="sticky top-0 z-30 bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex h-7 w-full items-center gap-1.5 border-b border-border px-3 text-left text-[10px] font-semibold uppercase tracking-wider ${tone}`}
      >
        {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        <span className="flex-1 truncate">{title}</span>
        <span>{count}</span>
      </button>
    </div>
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
  const [findingsOpen, setFindingsOpen] = useState(true);
  const [heldOpen, setHeldOpen] = useState(true);
  const [scenariosOpen, setScenariosOpen] = useState(true);

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

  // Split the visible rows into three blocks (bad-news-first: findings → held →
  // healthy scenarios), each grouped doc › section in first-seen order.
  const findingRows = useMemo(() => visible.filter((r) => r.kind === 'finding'), [visible]);
  const heldRows = useMemo(() => visible.filter((r) => r.kind === 'held'), [visible]);
  const scenarioRows = useMemo(() => visible.filter((r) => r.kind === 'scenario'), [visible]);
  const findingGroups = useMemo(() => groupByDocSection(findingRows), [findingRows]);
  const heldGroups = useMemo(() => groupByDocSection(heldRows), [heldRows]);
  const scenarioGroups = useMemo(() => groupByDocSection(scenarioRows), [scenarioRows]);

  // Split counts for the honest "N of M scenarios · K findings · H held" line.
  const totalScenarios = useMemo(() => rows.filter((r) => r.kind === 'scenario').length, [rows]);
  const totalFindings = useMemo(() => rows.filter((r) => r.kind === 'finding').length, [rows]);
  const totalHeld = useMemo(() => rows.filter((r) => r.kind === 'held').length, [rows]);
  const visScenarios = scenarioRows.length;
  const visFindings = findingRows.length;
  const visHeld = heldRows.length;
  const hasFindings = visFindings > 0;
  const hasHeld = visHeld > 0;
  // The "Scenarios" label appears only when a bad-news block precedes it.
  const hasPrecedingBlock = hasFindings || hasHeld;

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
    // The MAIN pane carries the single CTA empty state — here the left panel stays
    // quiet (one muted line) so two identical cards never sit side by side.
    return (
      <div className="flex h-full items-center justify-center px-4">
        <p className="text-center text-xs text-muted-foreground">No scenarios yet.</p>
      </div>
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
          {totalHeld > 0 && (
            <>
              {' · '}
              {visHeld} held
            </>
          )}
        </div>
      </div>

      {/* Bad-news-first inventory: "Findings" (red) → "Held" (amber limbo) →
          "Scenarios" (healthy) — decisions, then withheld work, then inventory. */}
      {visible.length === 0 ? (
        <div className="px-3 py-6 text-center text-xs text-muted-foreground">
          No scenarios match these filters.
        </div>
      ) : (
        <div className="flex-1 overflow-auto" role="list" aria-label="Scenario inventory">
          {hasFindings && (
            <div>
              {/* Findings block header — red-tinted attention, sticks above its
                  doc/section headers (higher z-index); collapsible. */}
              <BlockHeader
                title="Findings"
                count={visFindings}
                open={findingsOpen}
                onToggle={() => setFindingsOpen((v) => !v)}
                tone="bg-red-500/15 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
              />
              {findingsOpen && (
                <GroupedRows groups={findingGroups} withBlockHeader activeId={activeId} onOpen={onOpen} />
              )}
            </div>
          )}
          {hasHeld && (
            <div>
              {/* Held block header — amber "limbo" (birth-passed but withheld), never
                  the findings' red; collapsible. */}
              <BlockHeader
                title="Held"
                count={visHeld}
                open={heldOpen}
                onToggle={() => setHeldOpen((v) => !v)}
                tone="bg-amber-500/15 text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
              />
              {heldOpen && (
                <GroupedRows groups={heldGroups} withBlockHeader activeId={activeId} onOpen={onOpen} />
              )}
            </div>
          )}
          {scenarioRows.length > 0 && (
            <div>
              {/* A "Scenarios" label only when a bad-news block precedes it, so the
                  boundary between blocks is never ambiguous; a lone list needs none. */}
              {hasPrecedingBlock ? (
                <>
                  <BlockHeader
                    title="Scenarios"
                    count={visScenarios}
                    open={scenariosOpen}
                    onToggle={() => setScenariosOpen((v) => !v)}
                    tone="bg-muted text-muted-foreground hover:text-foreground"
                  />
                  {scenariosOpen && (
                    <GroupedRows
                      groups={scenarioGroups}
                      withBlockHeader
                      activeId={activeId}
                      onOpen={onOpen}
                    />
                  )}
                </>
              ) : (
                <GroupedRows
                  groups={scenarioGroups}
                  withBlockHeader={false}
                  activeId={activeId}
                  onOpen={onOpen}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
