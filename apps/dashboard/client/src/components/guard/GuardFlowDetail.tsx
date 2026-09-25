/**
 * THE guard entity, whole, a flow AND the test that realizes it, on one page.
 *
 * Flows and tests were two tabs over one row of data (one flow, one scenario), so
 * a reader had to hold two addresses for one thing. There is now ONE: this detail.
 * It reads top-down, widest fact first:
 *
 *   header       status · markers · the flow id · the View/YAML switch
 *                the flow's TITLE and its GOAL
 *   milestones   the claim sentences in order, each linking to the section that
 *                states it, a plain list, carrying no state of its own. It renders
 *                whenever the flow has milestones, test or no test: a step names
 *                its milestone only once opened, so the step list below is not a
 *                second reading of the chain
 *   ----- and then the test's own WORKSPACE ({@link GuardScenarioBody}), which
 *   claims every pixel the header leaves: verdict · filmstrip · steps | inspector ·
 *   drawers (transcript · interfaces · RULINGS) · footer facts. The flow-level
 *   ruling, "don't test this flow", lives in that drawer, after the evidence it
 *   is made on, rather than as a standing block below a page nobody scrolled to.
 *
 * A flow either HAS a test or it doesn't. Has one → the scenario body IS the rest
 * of the page, and it does not scroll: its panes do. Doesn't → a WHY-NO-TEST block
 * takes its place (and the ruling stays the page's last block): the state, then why,
 * as two separate reads ("Needs credentials and network access.", "Awaiting web
 * driver.", "Couldn't create the test, will retry next generate."). The one
 * exception is a needs-setup gap: that is a to-do, not a wall, so it carries the
 * same CTA the section side panel does, the service named, the explainer, and a
 * link straight to that service's card on the Dependencies page. An
 * `authoring-error` carries the run's own words for WHY authoring could not write
 * a test, deduped by message shape with an attempt count, the one place engine
 * words earn their keep.
 *
 * A flow with NO surface at all is the same rule, not an exception: it reads
 * "Blocked", then "No test yet, will be attempted on the next generate."
 *
 * MORE THAN ONE SURFACE is data the corpus does not produce today (one flow, one
 * CLI test), but the shape allows it: each surface then renders its own block
 * under a plain label. That label is the ONLY place a surface name appears, no
 * chips, anywhere: with one surface they carried zero information.
 *
 * Every status word here comes from the same vocabulary the flow LIST reads, so a
 * row and the detail it opens can never disagree.
 *
 * A flow the specs no longer derive (kept because its test still runs) has no goal
 * and no milestones BY NATURE. One plain sentence takes the goal's place and says
 * so; its test renders exactly like any other flow's.
 *
 * THE TWO READINGS: the header's mode switch is the test's YAML when the flow has
 * a test (the artifact a developer actually opens), and the flow's own
 * `scenarios/flows.json` entry when it has none, a flow always has a stored truth
 * to show, and it is whichever one exists ({@link ArtifactModeSwitch}).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight, Ban, Braces, Layers, PenLine } from "lucide-react";
import { guardFindingClass } from "@truecourse/shared";
import type {
  GuardClaimIdentity,
  GuardFlowDetail as GuardFlowDetailData,
  GuardFlowMilestoneView,
  GuardFlowScenarioRow,
  GuardGenerateError,
  GuardInterfaceRow,
} from "@truecourse/shared";
import {
  ArtifactModeSwitch,
  ArtifactRaw,
  useArtifactMode,
} from "@/dashboard/ui/artifact-view";
import { HoverPopover } from "@/dashboard/ui/hover-popover";
import { useGuardArtifactRaw } from "@/hooks/useGuardArtifactRaw";
import type { GuardDecisionsState } from "@/hooks/useGuardDecisions";
import { collapseAuthoringAttempts } from "@/lib/guard-report";
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
} from "@/lib/guard-flow-status";
import type { GuardTestBinds } from "@/lib/guard-tests";
import { GuardNeedsSetupCta } from "@/components/guard/GuardNeedsSetupCta";
import {
  GuardScenarioBody,
  type GuardEvidenceRef,
  type GuardTestViewModel,
} from "@/components/guard/GuardTestView";
import {
  GuardDismissedChip,
  GuardFlowStatusChip,
  GuardNotInSpecsChip,
  GuardToolDefectChip,
} from "@/components/guard/GuardStatusBadge";

const LABEL =
  "mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground";

const BTN =
  "inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground";

/** How many cases a milestone lists before the rest collapse behind a count. */
const CASES_SHOWN = 4;

/**
 * ONE milestone's cases: the situations this flow proves, each as the
 * source-grounded sentence it states.
 *
 * They carry no state of their own. A flow's cases stand or fall together — the
 * block below says Blocked once, the verdict says Passed once — so a mark per
 * case could only repeat it, in the one colour a reader is scanning for.
 *
 * A single case is listed like any other: a milestone's cases are a SELECTION
 * from its claim's, so one case usually means this flow proves one of the
 * claim's several situations, and the sentence is what says which. A long list
 * collapses: seventeen cases is a wall, and the count is the honest summary
 * until a reader asks for the rest.
 */
function MilestoneCases({
  cases,
}: {
  cases: NonNullable<GuardFlowMilestoneView['cases']>;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? cases : cases.slice(0, CASES_SHOWN);
  const rest = cases.length - shown.length;
  return (
    <ul className="mt-1.5 space-y-1" aria-label="Cases">
      {shown.map((c) => (
        <li key={c.id} className="flex min-w-0 items-start gap-1.5">
          <span
            aria-hidden
            className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40"
          />
          <span className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
            {c.claim}
          </span>
        </li>
      ))}
      {rest > 0 && (
        <li>
          <button
            type="button"
            onClick={() => setAll(true)}
            className="text-[11px] text-primary hover:underline"
          >
            {`${rest} more`}
          </button>
        </li>
      )}
    </ul>
  );
}

/**
 * The flow's milestones, the claim sentences in order, each linking to the
 * section that states it: the flow's CHAIN, shown whether or not a test exists.
 * A step names its milestone only once opened, so the step list does not stand
 * in for this.
 *
 * Below each claim ride its CASES, the situations this flow proves of it, as
 * muted sentences. They carry no mark of their own: the page's one verdict
 * stays the test's.
 */
function MilestoneList({
  milestones,
  onOpenSpec,
}: {
  milestones: readonly GuardFlowMilestoneView[];
  onOpenSpec: (doc: string, section: string) => void;
}) {
  return (
    <ol className="rounded border border-border" aria-label="Milestones">
      {milestones.map((m) => (
        <li
          key={m.order}
          className="flex min-w-0 items-start gap-2 border-b border-border/60 px-3 py-2 last:border-b-0"
        >
          {/* `M1`, not `1`: the step rows and the chips name a milestone that
              way, and a bare ordinal beside a claim reads as a list number. */}
          <span className="w-6 shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {`M${m.order}`}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] leading-snug text-foreground">
              {m.claimTitle}
            </span>
            {m.cases && m.cases.length > 0 && <MilestoneCases cases={m.cases} />}
          </span>
          <button
            type="button"
            onClick={() => onOpenSpec(m.doc, m.anchor)}
            title={`${m.doc} § ${m.anchor}`}
            className="inline-flex min-w-0 max-w-[45%] shrink-0 items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {/* Without `min-w-0` the label refuses to shrink and spills past the
                button, widening the pane instead of ellipsising. */}
            <span className="min-w-0 truncate">
              § {m.headingText ?? m.anchor}
            </span>
            <ArrowUpRight className="h-3 w-3 shrink-0" />
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * The surface rows to draw, with gaps that say the SAME THING folded into one.
 *
 * A gap is recorded per CASE, so one dependency holding up two situations is two
 * gaps carrying one reason and one action between them — which rendered as two
 * blocks a reader could not tell apart. The cases themselves are listed above,
 * so WHICH obligations are held up is already said; what this block adds is the
 * reason and the fix, and it says each once.
 *
 * Rows carrying a TEST are never folded: two tests are two results, however
 * alike they read.
 */
function foldGapRows(
  surfaces: readonly GuardFlowScenarioRow[],
): GuardFlowScenarioRow[] {
  const out: GuardFlowScenarioRow[] = [];
  const byReason = new Set<string>();
  for (const row of surfaces) {
    if (row.scenarioId != null || !row.gap) {
      out.push(row);
      continue;
    }
    const key = [row.surface ?? "", row.status, row.gap.kind, row.gap.reason].join("\u0000");
    if (byReason.has(key)) continue;
    byReason.add(key);
    out.push(row);
  }
  return out;
}

/**
 * WHY there is no test on this surface, the state, then the sentence. It is
 * deliberately NOT test-shaped: no verdict card, no steps, muted copy. The one
 * exception is the needs-setup CTA, which is a to-do the reader can clear today.
 *
 * It names no case. WHICH obligations are held up is said once, in the milestone
 * list above, where every case is already named; repeating them here
 * made the block a second copy of that list. What only this block can say is the
 * reason and the action, and it says each once.
 */
function WhyNoTest({
  row,
  attempted,
  blocked,
  errors,
  onOpenExternals,
}: {
  row: GuardFlowScenarioRow;
  /** False when nothing was ever attempted for this flow, the sentence changes. */
  attempted: boolean;
  /**
   * The run-level refusal that cancelled this flow's validation, when there was one.
   * It replaces the why-no-test sentence entirely: nothing here was examined, so
   * "will retry next generate" would be a promise the next run cannot keep.
   */
  blocked?: string;
  /** The flow's generate errors, the WHY behind an `authoring-error`. */
  errors: readonly GuardGenerateError[];
  onOpenExternals?: (service?: string) => void;
}) {
  // A refused run outranks even the needs-setup CTA: its gap was never re-examined.
  const needsSetup = blocked ? undefined : row.gap?.needsSetup;
  return (
    <div
      role="group"
      aria-label="Why there is no test yet"
      className="rounded border border-border bg-muted/20 px-3 py-2"
    >
      <GuardFlowStatusChip status={guardPlainStatus(row.status)} />
      {needsSetup ? (
        // The `guardWhyNoTest` sentence is dropped here on purpose: for a
        // needs-setup gap it IS `guardNeedsSetupNeed`, which the CTA already leads
        // with, and saying it twice would read as two different facts.
        <GuardNeedsSetupCta
          needsSetup={needsSetup}
          {...(onOpenExternals ? { onOpenExternals } : {})}
          explain
          className="mt-1.5"
        />
      ) : (
        <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground">
          {guardWhyNoTest(row.gap, {
            attempted,
            ...(blocked ? { blocked } : {}),
          })}
        </p>
      )}
      {/* WHY authoring could not produce a test, from the run's own words -
          deduped by message shape with the attempt count, so a flow re-asked
          three times reads as one reason tried three times, not three rows. */}
      {row.status === "authoring-error" && !blocked && (
        <AuthoringAttempts
          errors={errors}
          {...(row.surface ? { surface: row.surface } : {})}
        />
      )}
    </div>
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
    <ul className="mt-1.5 space-y-0.5">
      {attempts.map((a) => (
        <li key={a.message} className="flex items-start gap-2">
          <span className="min-w-0 flex-1 break-words font-mono text-[11px] leading-snug text-muted-foreground">
            {a.message}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {a.attempts} attempt{a.attempts === 1 ? "" : "s"}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The flow-level ruling: the button that rules the flow out, or, once it is
 * ruled out, what that means and the undo. It is deliberately the LAST block of
 * the detail: a destructive-feeling decision belongs after the evidence, not
 * above it. The header's marker chip is what a scanner sees.
 */
function DismissFlowAction({
  flowId,
  decisions,
}: {
  flowId: string;
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
          {GUARD_FLOW_DISMISSED_SENTENCE}{" "}
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
          <p className="mt-1 text-[11px] italic leading-relaxed text-muted-foreground">
            {dismissal.note}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <HoverPopover
        portal
        align="start"
        width="wide"
        content={GUARD_DISMISS_FLOW_HINT}
      >
        <button
          type="button"
          disabled={ruling}
          onClick={() =>
            void rule(() => decisions.dismissFlow({ flowId }))
          }
          className={`${BTN} disabled:opacity-50`}
        >
          <Ban className="h-3 w-3 shrink-0" />
          {GUARD_DISMISS_FLOW_ACTION}
        </button>
      </HoverPopover>
    </div>
  );
}

/**
 * The claim behind the failing milestone, resolved only to look up whether it
 * already carries a dismissal, never to offer creating one. `row.failedMilestone`
 * is the run/birth's own record of which milestone the failing step realized, so
 * this is a lookup, not a guess; a failure that named no milestone (an unmilestoned
 * setup step, or a hand-written test with no chain) resolves to null and the
 * dismissal note stays hidden.
 */
function failedMilestoneClaim(
  row: GuardFlowScenarioRow,
  milestones: readonly GuardFlowMilestoneView[],
): GuardClaimIdentity | null {
  const failed = row.failedMilestone;
  const milestone =
    failed != null ? milestones.find((m) => m.order === failed) : undefined;
  return milestone
    ? {
        doc: milestone.doc,
        anchor: milestone.anchor,
        title: milestone.claimTitle,
      }
    : null;
}

/**
 * The EXISTING dismissal already recorded against the failing milestone's claim -
 * a note and its undo, never a way to create one. Creating a dismissal is the
 * flow-level ruling at the foot of the page, the only MANUAL unit.
 *
 * A dismissal the TOOL recorded (`auto`) is never passed off as the reader's own:
 * the note names the machine and quotes the reason it gave, and the undo stays -
 * a machine's call is exactly the kind a human revisits.
 */
function ClaimDismissalNote({
  claim,
  decisions,
}: {
  claim: GuardClaimIdentity;
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

  const dismissal = decisions.dismissalFor(claim);
  if (!dismissal) return null;

  const undo = async () => {
    setRuling(true);
    try {
      await decisions.undismiss(claim);
    } finally {
      if (mounted.current) setRuling(false);
    }
  };

  return (
    <div className="mt-3 text-[11px] text-muted-foreground">
      <p>
        {dismissal.auto
          ? "Guard dismissed this claim automatically"
          : "This claim is dismissed"}{" "}
        -{" "}
        <button
          type="button"
          disabled={ruling}
          onClick={() => void undo()}
          className="underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        >
          undo
        </button>
      </p>
      {/* The machine's stated reason, verbatim, never re-worded. */}
      {dismissal.auto && dismissal.reason && (
        <p className="mt-1 italic leading-relaxed">{dismissal.reason}</p>
      )}
    </div>
  );
}

/** A flow's stored test as the shared scenario model. */
function scenarioModel(
  row: GuardFlowScenarioRow,
  detail: GuardFlowDetailData,
  binds: GuardTestBinds | undefined,
): GuardTestViewModel {
  const view = guardTestStatusView({
    status: row.status,
    ...(row.stage ? { stage: row.stage } : {}),
  });
  // A BIRTH failure's transcript is addressed by its stored path (no run wrote it);
  // a run's transcript is addressed by run + test id, the run THAT ROW came from,
  // since the board is merged across runs and the detail's own `runId` is only the
  // run that wrote it last.
  const rowRunId = row.runId ?? detail.runId;
  const evidence: GuardEvidenceRef | null =
    row.stage === "birth" && row.evidencePath
      ? { kind: "birth", path: row.evidencePath }
      : row.hasEvidence && rowRunId != null && row.stage !== "birth"
        ? { kind: "run", runId: rowRunId }
        : null;
  return {
    id: row.scenarioId!,
    title: row.title ?? row.scenarioId!,
    status: view,
    provenance: "Latest state",
    ...(row.durationMs != null ? { durationMs: row.durationMs } : {}),
    ...(row.failure ? { failure: row.failure } : {}),
    // The verdict the generate reached about this birth failure, whose fault it is.
    ...(row.triage ? { triage: row.triage } : {}),
    ...(row.failedMilestone != null
      ? { failedMilestone: row.failedMilestone }
      : {}),
    ...(row.interfaceDrifted ? { interfaceDrifted: true } : {}),
    ...(row.blockedPrecondition ? { blockedPrecondition: true } : {}),
    // NO `goal`: the flow's goal is already the header, one screen above. What the
    // body leads with is the TEST's own sentence, the level below it.
    ...(binds ? { binds } : {}),
    interfacePath: row.interfacePath,
    evidence,
  };
}

export function GuardFlowDetail({
  repoId,
  detail,
  interfaces = null,
  binds,
  decisions,
  onOpenSpec,
  onOpenInterface,
  onOpenExternals,
}: {
  /** Whose store the raw mode reads the artifact out of. */
  repoId: string;
  detail: GuardFlowDetailData;
  /** The mapped interface catalog, for the diagrams the test drives; null = unmapped. */
  interfaces?: GuardInterfaceRow[] | null;
  /** scenarioId → the spec section it binds to (the inventory join). */
  binds?: ReadonlyMap<string, GuardTestBinds>;
  /** The dismissals state; omitted (guard reads off) = no ruling. */
  decisions?: GuardDecisionsState;
  onOpenSpec: (doc: string, section: string) => void;
  onOpenInterface: (interfaceId: string) => void;
  /** Jump to the Dependencies tab, on the named service's card. */
  onOpenExternals?: (service?: string) => void;
}) {
  const dismissed = decisions?.flowDismissal(detail.flowId) != null;
  // OUR OWN withheld defects (a faulty scenario, a fidelity rejection). They are
  // never a status and never red, nothing was stored and nothing in the repo
  // is broken, so they ride as a muted marker beside the status chip.
  const toolDefects = detail.findings.filter(
    (f) => guardFindingClass(f) === "defect",
  ).length;

  // A flow with no surface at all has no test AND no gap to explain it, whether
  // authoring ran and failed, or nothing has been attempted for it yet. Both read
  // as ONE honest block (the state, then what happens next), never a bare line of
  // text: the two differ only in the sentence they carry.
  const attempted = detail.errors.length > 0;
  // A run the runner REFUSED (a broken recipe, a half-configured external account)
  // cancelled this flow's validation before anything ran. That is a different fact
  // from "authoring failed", and the block says so instead of promising a retry.
  const blocked = guardRefusalError(detail.errors)?.message;
  const rows: GuardFlowScenarioRow[] =
    detail.surfaces.length > 0
      ? foldGapRows(detail.surfaces)
      : [
          {
            status: "unguarded",
            birthPassed: false,
            hasEvidence: false,
            interfacePath: [],
          },
        ];

  // The flow's TRUTH ON DISK: its test's YAML when it has one, else its own entry
  // in the flow corpus. One switch, whichever artifact exists.
  const test = rows.find((r) => r.scenarioId != null) ?? null;
  const { mode, setMode, raw } = useArtifactMode(test ? "YAML" : "JSON");
  const flowRaw = useGuardArtifactRaw(
    repoId,
    "flow",
    detail.flowId,
    raw && !test,
  );

  // Every stored test on the flow as its scenario model, by id. Keyed rather
  // than singular so a second surface renders its OWN test rather than nothing.
  const models = useMemo(
    () =>
      new Map(
        rows
          .filter((r) => r.scenarioId != null)
          .map((r) => [
            r.scenarioId!,
            scenarioModel(r, detail, binds?.get(r.scenarioId!)),
          ]),
      ),
    [rows, detail, binds],
  );

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      {/* The page's ONE vertical scroll, and the header scrolls WITH it, a
          pinned title bar cost height the reading needs. x is clipped so a wide
          line can only scroll its own block. */}
      <div
        data-pane
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overflow-x-hidden"
      >
      <div className="min-w-0 shrink-0 border-b border-border bg-card px-6 py-4">

        <div className="flex flex-wrap items-center gap-2">
          {/* The SAME word the flow wears in the list, in the SAME first position
              every guard row and header puts it, one vocabulary, one table. */}
          <GuardFlowStatusChip
            status={guardFlowPlainStatus({
              status: detail.status,
              bucket: detail.bucket,
              findings: detail.findings.filter(
                (f) => guardFindingClass(f) !== "defect",
              ).length,
            })}
          />
          {/* Not a status: the same marker the list row wears. The sentence below
              stays, the chip is the spot, the sentence is the explanation. */}
          {detail.orphaned && <GuardNotInSpecsChip />}
          {/* Likewise not a status: the user's own ruling, spotted while scanning.
              The Dismissed block at the foot carries the sentence and the undo. */}
          {dismissed && <GuardDismissedChip />}
          {toolDefects > 0 && <GuardToolDefectChip />}
          {detail.epic && (
            <HoverPopover
              portal
              width="narrow"
              content={`Epic flow, chains ${detail.composedOf.length} flows.`}
            >
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <Layers className="h-3 w-3" />
                epic
              </span>
            </HoverPopover>
          )}
          {detail.manual && (
            <HoverPopover
              portal
              width="narrow"
              content="Hand-written test, it belongs to no synthesized flow."
            >
              <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                <PenLine className="h-3 w-3" />
                manual
              </span>
            </HoverPopover>
          )}
          <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
            {detail.flowId}
          </span>
          <ArtifactModeSwitch
            format={test ? "YAML" : "JSON"}
            mode={mode}
            onSelect={setMode}
            className="ml-auto"
          />
        </div>
        <h2 className="mt-1 break-words text-sm font-semibold text-foreground">
          {detail.title}
        </h2>
        {detail.goal ? (
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            {detail.goal}
          </p>
        ) : (
          detail.orphaned && (
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {GUARD_UNDERIVED_SENTENCE}
              {detail.orphanedReason && ` Retired: ${detail.orphanedReason}.`}
            </p>
          )
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-5 px-6 py-4">
        {raw ? (
          // The stored artifact, whichever one this flow has.
          test ? (
            <GuardScenarioBody
              repoId={repoId}
              test={models.get(test.scenarioId!)!}
              interfaces={interfaces}
              raw
              onOpenSpec={onOpenSpec}
            />
          ) : (
            <ArtifactRaw content={flowRaw.content} label="flow source" />
          )
        ) : (
          <>
            {/* The chain, as a list, ALWAYS. A step names its milestone only
                once opened, so the step rows do not stand in for this list;
                they carry an `M2` chip that points back at it. */}
            {detail.milestones.length > 0 && (
              <div>
                <div className={LABEL}>Milestones</div>
                <MilestoneList
                  milestones={detail.milestones}
                  onOpenSpec={onOpenSpec}
                />
              </div>
            )}

            {/* ONE block per surface. With the single surface the corpus produces
                today there is no label at all, the page IS the test. */}
            {rows.map((row, i) => {
              const model = row.scenarioId
                ? models.get(row.scenarioId)
                : undefined;
              // The existing-dismissal note is offered on a FAILING test only, and
              // only when the failing milestone's claim resolves.
              const claim =
                model?.status.plain === "failed"
                  ? failedMilestoneClaim(row, detail.milestones)
                  : null;
              return (
                <div
                  key={
                    row.scenarioId ??
                    `${row.surface ?? "none"}-${row.status}-${i}`
                  }
                  className={`flex min-w-0 flex-col gap-5 ${
                    model ? "min-h-0 flex-1" : ""
                  }`}
                >
                  {rows.length > 1 && row.surface && (
                    // A surface NAME, plain, never a chip. It appears only when
                    // there is a second surface to tell this one apart from.
                    <div className={LABEL}>{surfaceLabel(row.surface)}</div>
                  )}
                  {model ? (
                    <GuardScenarioBody
                      repoId={repoId}
                      test={model}
                      interfaces={interfaces}
                      showGoal={rows.length > 1 || !detail.goal}
                      onOpenInterface={onOpenInterface}
                      onOpenSpec={onOpenSpec}
                      {...(decisions
                        ? {
                            // The rulings ride INSIDE the test's own drawer row:
                            // a decision belongs after the evidence, and a standing
                            // block under it was a footer nobody read.
                            rulings: (
                              <div className="space-y-3">
                                <DismissFlowAction
                                  flowId={detail.flowId}
                                  decisions={decisions}
                                />
                                {claim && (
                                  <ClaimDismissalNote
                                    claim={claim}
                                    decisions={decisions}
                                  />
                                )}
                              </div>
                            ),
                          }
                        : {})}
                      {...(!row.outcome && row.stage !== "birth"
                        ? {
                            notes: (
                              <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
                                The last run has no result for this test. Start
                                a Flow run to test it.
                              </p>
                            ),
                          }
                        : {})}
                    />
                  ) : (
                    <WhyNoTest
                      row={row}
                      attempted={attempted}
                      errors={detail.errors}
                      {...(blocked ? { blocked } : {})}
                      {...(onOpenExternals ? { onOpenExternals } : {})}
                    />
                  )}
                </div>
              );
            })}

            {/* A flow with no test still has a realization plan, the interfaces it
                WOULD walk. With a test, its own Interface section above says it
                (and draws each one), so this never renders twice. */}
            {!test && detail.interfaceIds.length > 0 && (
              <div>
                <div className={LABEL}>Interfaces</div>
                <div className="flex flex-col items-start gap-1">
                  {detail.interfaceIds.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onOpenInterface(id)}
                      className="inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-left font-mono text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                    >
                      <Braces className="h-3 w-3 shrink-0" />
                      <span className="truncate">{id}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* A flow with a TEST carries its ruling inside that test's drawer
                row, where the decision follows the evidence it is made on. A flow
                with none has no such row, the ruling stays the page's last
                block, exactly as it reads today. */}
            {decisions && !test && (
              <DismissFlowAction
                flowId={detail.flowId}
                decisions={decisions}
              />
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}
