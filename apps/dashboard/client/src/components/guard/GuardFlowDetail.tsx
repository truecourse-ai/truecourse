/**
 * A flow's MAIN-PANE detail, on ONE rule:
 *
 *   a flow either has a test or it doesn't. Has one → show the test and its
 *   status. Doesn't → say what state it is in, then why, as two separate reads.
 *
 * So the "Tests" block renders exactly ONE row per surface: the TEST (clickable —
 * it opens on the Tests tab, the one place a test lives) with its status word, or
 * a WHY-NO-TEST row — the surface, its status chip, and the explanation on its own
 * line ("Needs credentials and network access.", "Awaiting web driver.",
 * "Couldn’t create the test — will retry next generate."). A why-no-test row is
 * deliberately NOT test-shaped: no "CLI test" lead, no click target, muted copy —
 * only a real test looks like a test. There is no gaps block, no findings block
 * and no authoring-errors block: each was the same news told twice, in engine
 * words.
 *
 * A flow with NO surface at all is the same rule, not an exception: it renders one
 * row too — "Not generated", then "No test yet — will be attempted on the next
 * generate." The block never degrades to a bare line of prose.
 *
 * Every status word here comes from the same vocabulary the Flows LIST reads, so
 * a row and the detail it opens can never disagree.
 *
 * The milestone graph stays the spine — each node jumps to its bound spec section
 * in Coverage, so the flow always reads back to the document that claims it.
 * Read-only, no toggles (chrome-diet).
 *
 * A flow the specs no longer derive (kept because its test still runs) has no goal
 * and no milestones BY NATURE. One plain sentence takes the goal's place and says
 * so; its tests render exactly like any other flow's.
 */

import { ArrowUpRight, Layers, PenLine, Route } from 'lucide-react';
import type { GuardFlowDetail as GuardFlowDetailData, GuardFlowScenarioRow } from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';
import { generatePaintNodes } from '@/lib/guard-flow-paint';
import {
  GUARD_UNDERIVED_SENTENCE,
  guardFlowPlainStatus,
  guardPlainStatus,
  guardTestStatusView,
  guardWhyNoTest,
  surfaceLabel,
} from '@/lib/guard-flow-status';
import { guardTestLabel } from '@/lib/guard-tests';
import { GuardMilestoneGraph } from './GuardMilestoneGraph';
import { GuardFlowStatusChip, GuardNotInSpecsChip } from './GuardStatusBadge';

const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

/**
 * One surface, one row. With a test: "CLI test · <status>", the test's title, and
 * a click that opens it on the Tests tab. Without one: the surface's own name, the
 * status chip, and the explanation beneath — a plain, unclickable read.
 */
function SurfaceRow({
  row,
  attempted,
  onOpenTest,
}: {
  row: GuardFlowScenarioRow;
  /** False when nothing was ever attempted for this flow — the sentence changes. */
  attempted: boolean;
  onOpenTest: (testId: string) => void;
}) {
  if (!row.scenarioId) {
    return (
      <div
        role="listitem"
        className="flex w-full flex-col gap-0.5 border-b border-border/60 bg-muted/20 px-3 py-2"
      >
        <div className="flex w-full flex-wrap items-center gap-1">
          {row.surface && (
            <span className="text-[11px] font-medium text-muted-foreground">{surfaceLabel(row.surface)}</span>
          )}
          <GuardFlowStatusChip status={guardPlainStatus(row.status)} />
        </div>
        <span className="text-[12px] leading-snug text-muted-foreground">
          {guardWhyNoTest(row.gap, { attempted })}
        </span>
      </div>
    );
  }

  const view = guardTestStatusView({ status: row.status, ...(row.stage ? { stage: row.stage } : {}) });
  return (
    <button
      type="button"
      role="listitem"
      onClick={() => onOpenTest(row.scenarioId!)}
      title={`${row.scenarioId} — open the test`}
      className="flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-3 py-2 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex w-full flex-wrap items-center gap-1">
        <span className="text-[11px] font-medium text-muted-foreground">{guardTestLabel(row.surface)}</span>
        <span className="text-[11px] text-muted-foreground">·</span>
        <GuardFlowStatusChip status={view.plain} word={view.word} />
        {row.journeyDrifted && (
          <HoverPopover content="The code surface this test was grounded on has moved since it was written. Never a pass/fail input.">
            <span aria-label="journey drift" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          </HoverPopover>
        )}
        <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-[11px] text-primary">
          open
          <ArrowUpRight className="h-3 w-3" />
        </span>
      </div>
      <span className="w-full text-[13px] leading-snug text-foreground">{row.title ?? row.scenarioId}</span>
    </button>
  );
}

export function GuardFlowDetail({
  detail,
  onOpenSpec,
  onOpenTest,
  onOpenJourney,
}: {
  detail: GuardFlowDetailData;
  onOpenSpec: (doc: string, section: string) => void;
  /** Open a test on the Tests tab — a test has exactly one home. */
  onOpenTest: (testId: string) => void;
  onOpenJourney: (journeyId: string) => void;
}) {
  const nodes = generatePaintNodes(detail.milestones, detail.surfaces, detail.findings);

  // A flow with no surface at all has no test AND no gap to explain it — whether
  // authoring ran and failed, or nothing has been attempted for it yet. Both read
  // as ONE honest row (the state, then what happens next), never a bare line of
  // text: the two differ only in the sentence the row carries.
  const attempted = detail.errors.length > 0;
  const rows: GuardFlowScenarioRow[] =
    detail.surfaces.length > 0
      ? detail.surfaces
      : [{ status: 'unguarded', birthPassed: false, hasEvidence: false, journeyPath: [] }];

  return (
    <div className="flex h-full flex-col bg-background">
      <div className="border-b border-border bg-card px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {/* The SAME word the flow wears in the list — one vocabulary, one table. */}
          <GuardFlowStatusChip
            status={guardFlowPlainStatus({
              status: detail.status,
              bucket: detail.bucket,
              findings: detail.findings.length,
            })}
          />
          {/* Not a status: the same marker the list row wears. The sentence below
              stays — the chip is the spot, the sentence is the explanation. */}
          {detail.orphaned && <GuardNotInSpecsChip />}
          {detail.epic && (
            <HoverPopover content={`Epic flow — chains ${detail.composedOf.length} flows.`}>
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <Layers className="h-3 w-3" />
                epic
              </span>
            </HoverPopover>
          )}
          {detail.manual && (
            <HoverPopover content="Hand-written test — it belongs to no synthesized flow.">
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <PenLine className="h-3 w-3" />
                manual
              </span>
            </HoverPopover>
          )}
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{detail.flowId}</span>
        </div>
        <h2 className="mt-1 text-sm font-semibold text-foreground">{detail.title}</h2>
        {detail.goal ? (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{detail.goal}</p>
        ) : (
          detail.orphaned && (
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{GUARD_UNDERIVED_SENTENCE}</p>
          )
        )}
      </div>

      <div className="flex-1 space-y-5 overflow-auto px-6 py-4">
        {nodes.length > 0 && (
          <div>
            <div className={LABEL}>Milestones</div>
            <GuardMilestoneGraph
              nodes={nodes}
              onSelectMilestone={(node) => node.doc && node.anchor && onOpenSpec(node.doc, node.anchor)}
            />
          </div>
        )}

        <div>
          <div className={LABEL}>Tests</div>
          <div className="rounded border border-border" role="list" aria-label="Tests">
            {rows.map((row, i) => (
              <SurfaceRow
                key={`${row.surface ?? 'none'}-${row.scenarioId ?? i}`}
                row={row}
                attempted={attempted}
                onOpenTest={onOpenTest}
              />
            ))}
          </div>
        </div>

        {detail.journeyIds.length > 0 && (
          <div>
            <div className={LABEL}>Journeys</div>
            {/* One reference per line — the same row idiom the Journeys pane uses
                for the flows that use a journey, so both sides of the link read
                identically. */}
            <div className="flex flex-col items-start gap-1">
              {detail.journeyIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => onOpenJourney(id)}
                  className="inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-left font-mono text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                >
                  <Route className="h-3 w-3 shrink-0" />
                  <span className="truncate">{id}</span>
                </button>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
