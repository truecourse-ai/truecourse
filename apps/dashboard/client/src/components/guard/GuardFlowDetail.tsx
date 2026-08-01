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
 * only a real test looks like a test. The ONE exception is a needs-setup row
 * (item 65): it is a to-do, not a wall, so it carries the same CTA the section
 * side panel does — the service named, the explainer, and a link straight to that
 * service's card on the External APIs page. It is still not test-shaped: orange,
 * unclickable as a whole, with one button inside it. There is no gaps block, no findings block
 * and no authoring-errors block: each was the same news told twice, in engine
 * words. An `authoring-error` row is the one place engine words earn their keep —
 * WHY authoring could not write a test is information no sentence carries — so
 * they ride INSIDE that row, deduped by message shape with an attempt count.
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
 *
 * The ONE ruling a reader makes here is the FLOW-level dismissal (item 82): "don't
 * test this flow" writes `scenarios/decisions.json`, and the next generate drops
 * the flow with its tests. A dismissed flow says so in its header and offers the
 * undo — the flow is the only manual dismissal unit, since a generated test's id
 * moves on regenerate.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Ban, Layers, PenLine, Route } from 'lucide-react';
import { guardFindingClass } from '@truecourse/shared';
import type { GuardFlowDetail as GuardFlowDetailData, GuardFlowScenarioRow, GuardGenerateError } from '@truecourse/shared';
import { HoverPopover } from '@/components/ui/hover-popover';
import type { GuardDecisionsState } from '@/hooks/useGuardDecisions';
import { generatePaintNodes } from '@/lib/guard-flow-paint';
import { collapseAuthoringAttempts } from '@/lib/guard-report';
import {
  GUARD_DISMISS_FLOW_ACTION,
  GUARD_DISMISS_FLOW_HINT,
  GUARD_FLOW_DISMISSED_SENTENCE,
  GUARD_UNDERIVED_SENTENCE,
  guardFlowPlainStatus,
  guardPlainStatus,
  guardRefusalError,
  guardTestStatusView,
  guardWhyNoTest,
  surfaceLabel,
} from '@/lib/guard-flow-status';
import { guardTestLabel } from '@/lib/guard-tests';
import { GuardMilestoneGraph } from './GuardMilestoneGraph';
import { GuardNeedsSetupCta } from './GuardNeedsSetupCta';
import { GuardDismissedChip, GuardFlowStatusChip, GuardNotInSpecsChip, GuardToolDefectChip } from './GuardStatusBadge';

const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';

const BTN =
  'inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground';

/**
 * One surface, one row. With a test: "CLI test · <status>", the test's title, and
 * a click that opens it on the Tests tab. Without one: the surface's own name, the
 * status chip, and the explanation beneath — a plain, unclickable read.
 */
function SurfaceRow({
  row,
  attempted,
  blocked,
  errors,
  onOpenTest,
  onOpenExternals,
}: {
  row: GuardFlowScenarioRow;
  /** False when nothing was ever attempted for this flow — the sentence changes. */
  attempted: boolean;
  /** The flow's generate errors — the WHY behind an `authoring-error` row. */
  errors: readonly GuardGenerateError[];
  /**
   * The run-level refusal that cancelled this flow's validation, when there was one.
   * It replaces the why-no-test sentence entirely: nothing here was examined, so
   * "will retry next generate" would be a promise the next run cannot keep.
   */
  blocked?: string;
  onOpenTest: (testId: string) => void;
  /** Jump to the External APIs tab for a needs-setup row's service (item 65). */
  onOpenExternals?: (service?: string) => void;
}) {
  if (!row.scenarioId) {
    // Item 65: the one why-no-test that is a TO-DO gets the same CTA the section
    // side panel carries — the service, the explainer, and the link that provides
    // it. The `guardWhyNoTest` sentence is dropped here on purpose: for a
    // needs-setup gap it IS `guardNeedsSetupNeed`, which the CTA already leads
    // with, and saying it twice would read as two different facts.
    // A refused run outranks even the needs-setup CTA: its gap was never re-examined.
    const needsSetup = blocked ? undefined : row.gap?.needsSetup;
    return (
      <div
        role="listitem"
        className={`flex w-full flex-col gap-0.5 border-b border-border/60 px-3 py-2 ${
          needsSetup ? 'bg-orange-500/[0.07]' : 'bg-muted/20'
        }`}
      >
        <div className="flex w-full flex-wrap items-center gap-1">
          {row.surface && (
            <span className="text-[11px] font-medium text-muted-foreground">{surfaceLabel(row.surface)}</span>
          )}
          <GuardFlowStatusChip status={guardPlainStatus(row.status)} />
        </div>
        {needsSetup ? (
          <GuardNeedsSetupCta
            needsSetup={needsSetup}
            onOpenExternals={onOpenExternals}
            explain
            className=""
          />
        ) : (
          <span className="text-[12px] leading-snug text-muted-foreground">
            {guardWhyNoTest(row.gap, { attempted, ...(blocked ? { blocked } : {}) })}
          </span>
        )}
        {/* WHY authoring could not produce a test, from the run's own words —
            deduped by message shape with the attempt count, so a flow re-asked
            three times reads as one reason tried three times, not three rows. */}
        {row.status === 'authoring-error' && !blocked && (
          <AuthoringAttempts errors={errors} surface={row.surface} />
        )}
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
          <HoverPopover portal width="narrow" content="The code surface this test was grounded on has moved since it was written. Never a pass/fail input.">
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

/** The deduped authoring failures behind an `authoring-error` row, with counts. */
function AuthoringAttempts({
  errors,
  surface,
}: {
  errors: readonly GuardGenerateError[];
  surface?: string;
}) {
  const attempts = collapseAuthoringAttempts(errors, surface);
  if (attempts.length === 0) return null;
  return (
    <ul className="mt-0.5 space-y-0.5">
      {attempts.map((a) => (
        <li key={a.message} className="flex items-start gap-2">
          <span className="min-w-0 flex-1 break-words font-mono text-[11px] leading-snug text-muted-foreground">
            {a.message}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {a.attempts} attempt{a.attempts === 1 ? '' : 's'}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The flow-level ruling: the button that rules the flow out, or — once it is
 * ruled out — what that means and the undo. It is deliberately the LAST block of
 * the detail: a destructive-feeling decision belongs after the evidence, not
 * above it. The header's marker chip is what a scanner sees.
 */
function DismissFlowAction({
  flowId,
  title,
  decisions,
}: {
  flowId: string;
  title: string;
  decisions: GuardDecisionsState;
}) {
  const [ruling, setRuling] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const dismissal = decisions.flowDismissal(flowId);
  const rule = async (write: () => Promise<void>) => {
    setRuling(true);
    try {
      await write();
    } finally {
      if (mounted.current) setRuling(false);
    }
  };

  if (dismissal) {
    return (
      <div>
        <div className={LABEL}>Dismissed</div>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          {GUARD_FLOW_DISMISSED_SENTENCE}{' '}
          <button
            type="button"
            disabled={ruling}
            onClick={() => void rule(() => decisions.undismissFlow(flowId))}
            className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
          >
            Un-dismiss
          </button>
        </p>
        {dismissal.note && (
          <p className="mt-1 text-[11px] italic leading-relaxed text-muted-foreground">{dismissal.note}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <HoverPopover portal align="start" width="wide" content={GUARD_DISMISS_FLOW_HINT}>
        <button
          type="button"
          disabled={ruling}
          onClick={() => void rule(() => decisions.dismissFlow({ flowId, title }))}
          className={`${BTN} disabled:opacity-50`}
        >
          <Ban className="h-3 w-3 shrink-0" />
          {GUARD_DISMISS_FLOW_ACTION}
        </button>
      </HoverPopover>
    </div>
  );
}

export function GuardFlowDetail({
  detail,
  decisions,
  onOpenSpec,
  onOpenTest,
  onOpenJourney,
  onOpenExternals,
}: {
  detail: GuardFlowDetailData;
  /** The dismissals state; omitted (guard reads off / PR scope unresolved) = no ruling. */
  decisions?: GuardDecisionsState;
  onOpenSpec: (doc: string, section: string) => void;
  /** Open a test on the Tests tab — a test has exactly one home. */
  onOpenTest: (testId: string) => void;
  onOpenJourney: (journeyId: string) => void;
  /** Jump to the External APIs tab, on the named service's card (item 65). */
  onOpenExternals?: (service?: string) => void;
}) {
  const nodes = generatePaintNodes(detail.milestones, detail.surfaces, detail.findings);
  const dismissed = decisions?.flowDismissal(detail.flowId) != null;
  // OUR OWN withheld defects (a faulty scenario, a fidelity rejection). They are
  // never a status and never red — nothing was committed and nothing in the repo
  // is broken — so they ride as a muted marker beside the status chip.
  const toolDefects = detail.findings.filter((f) => guardFindingClass(f) === 'defect').length;

  // A flow with no surface at all has no test AND no gap to explain it — whether
  // authoring ran and failed, or nothing has been attempted for it yet. Both read
  // as ONE honest row (the state, then what happens next), never a bare line of
  // text: the two differ only in the sentence the row carries.
  const attempted = detail.errors.length > 0;
  // A run the runner REFUSED (a broken recipe, a half-configured external account)
  // cancelled this flow's validation before anything ran. That is a different fact
  // from "authoring failed", and the rows say so instead of promising a retry.
  const blocked = guardRefusalError(detail.errors)?.message;
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
              findings: detail.findings.filter((f) => guardFindingClass(f) !== 'defect').length,
            })}
          />
          {/* Not a status: the same marker the list row wears. The sentence below
              stays — the chip is the spot, the sentence is the explanation. */}
          {detail.orphaned && <GuardNotInSpecsChip />}
          {/* Likewise not a status: the user's own ruling, spotted while scanning.
              The Dismissed block at the foot carries the sentence and the undo. */}
          {dismissed && <GuardDismissedChip />}
          {toolDefects > 0 && <GuardToolDefectChip />}
          {detail.epic && (
            <HoverPopover portal width="narrow" content={`Epic flow — chains ${detail.composedOf.length} flows.`}>
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <Layers className="h-3 w-3" />
                epic
              </span>
            </HoverPopover>
          )}
          {detail.manual && (
            <HoverPopover portal width="narrow" content="Hand-written test — it belongs to no synthesized flow.">
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
                errors={detail.errors}
                {...(blocked ? { blocked } : {})}
                onOpenTest={onOpenTest}
                {...(onOpenExternals ? { onOpenExternals } : {})}
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

        {decisions && (
          <DismissFlowAction flowId={detail.flowId} title={detail.title} decisions={decisions} />
        )}
      </div>
    </div>
  );
}
