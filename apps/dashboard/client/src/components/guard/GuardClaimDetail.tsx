/**
 * ONE claim, read in both directions.
 *
 *   UP    the document that states it, the claim is a quotation, and the
 *         quotation has a source a reader can open.
 *   DOWN  what stands behind it: its status, the flows that carry it (each with
 *         the milestone positions it is proved at, each a click into that flow)
 *         and the scenarios whose steps name it (with the step numbers).
 *
 * The status is the claim's own word, the worst over its flows; the reason line
 * under it says what decided a gap or a dismissal. Dismissing a claim is the
 * one ruling this page offers: the next generate drops the flows carrying it.
 *
 * A claim's truth is its entry in `scenarios/claims.json`, so the header carries
 * the same two-mode switch every artifact-backed entity has: this page, or that
 * entry verbatim ({@link ArtifactModeSwitch}).
 *
 * An untestable statement ({@link GuardUntestableDetail}) is the same page minus
 * everything it doesn't have: the text, why the scan refused it, and the
 * document it came from. It carries NO mode switch, a refused statement has no
 * id, so nothing in the store addresses it and there is no entry to show.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Ban, FileText, FlaskConical, Undo2 } from 'lucide-react';
import type { GuardClaimRow, GuardUntestableRow } from '@truecourse/shared';
import { ArtifactModeSwitch, ArtifactRaw, useArtifactMode } from '@/dashboard/ui/artifact-view';
import { HoverPopover } from '@/dashboard/ui/hover-popover';
import { useGuardArtifactRaw } from '@/hooks/useGuardArtifactRaw';
import type { GuardDecisionsState } from '@/hooks/useGuardDecisions';
import { guardNeedsSetupNeed, guardPlainStatus } from '@/lib/guard-flow-status';
import { GuardFlowStatusChip, GuardStatusBadge } from '@/components/guard/GuardStatusBadge';

const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';
const CHIP = 'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium';
const REF_BTN =
  'inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-left text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground';
/** The same row, with nowhere to go, a fact about the claim, not a destination. */
const REF_ROW =
  'inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-left text-[11px] text-muted-foreground';
const BTN =
  'inline-flex items-center gap-1 rounded border border-border px-2 py-1 text-[11px] text-foreground hover:bg-muted/40 disabled:opacity-50';

/** "step 3" / "steps 3, 5", which observations carry the claim's tag. */
function stepList(steps: readonly number[]): string {
  if (steps.length === 0) return 'no step';
  return `${steps.length === 1 ? 'step' : 'steps'} ${steps.join(', ')}`;
}

/** "milestone 3" / "milestones 1, 3", where a flow proves this claim. */
function milestoneList(orders: readonly number[]): string {
  if (orders.length === 0) return '';
  return `${orders.length === 1 ? 'milestone' : 'milestones'} ${orders.join(', ')}`;
}

/** The source line: the document this claim was read out of, the one jump back to the prose. */
function SourceLine({ doc, onOpenDoc }: { doc: string; onOpenDoc: (doc: string) => void }) {
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => onOpenDoc(doc)} className={REF_BTN}>
        <FileText className="h-3 w-3 shrink-0" />
        <span className="truncate">{doc}</span>
        <ArrowUpRight className="h-3 w-3 shrink-0" />
      </button>
    </div>
  );
}

/**
 * The ruling: dismiss the claim, or take the dismissal back. A dismissal the
 * TOOL recorded (`auto`) is named as the machine's call, with the reason it
 * gave, and the undo stays: a machine's call is exactly the kind a human revisits.
 */
function ClaimRuling({ claim, decisions }: { claim: GuardClaimRow; decisions: GuardDecisionsState }) {
  const [ruling, setRuling] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const rule = async (run: () => Promise<void>) => {
    setRuling(true);
    try {
      await run();
    } finally {
      if (mounted.current) setRuling(false);
    }
  };
  const dismissal = decisions.dismissalFor({ claimId: claim.id });
  if (dismissal) {
    return (
      <div className="space-y-1.5">
        <p className="text-[12px] text-muted-foreground">
          {dismissal.auto ? 'Dismissed by the tool' : 'Dismissed'}
          {dismissal.reason ? `: ${dismissal.reason}` : dismissal.note ? `: ${dismissal.note}` : ''}
        </p>
        <button
          type="button"
          disabled={ruling}
          onClick={() => void rule(() => decisions.undismiss({ claimId: claim.id }))}
          className={BTN}
        >
          <Undo2 className="h-3 w-3 shrink-0" />
          Test this claim again
        </button>
      </div>
    );
  }
  return (
    <HoverPopover
      portal
      align="start"
      width="wide"
      content="Rule this claim out of testing. The next Flow generation drops the flows that carry it, and it reads Not testable until the ruling is taken back."
    >
      <button
        type="button"
        disabled={ruling}
        onClick={() => void rule(() => decisions.dismiss({ claimId: claim.id }))}
        className={BTN}
      >
        <Ban className="h-3 w-3 shrink-0" />
        Don’t test this claim
      </button>
    </HoverPopover>
  );
}

export function GuardClaimDetail({
  repoId,
  claim,
  decisions,
  onOpenDoc,
  onOpenFlow,
}: {
  /** Whose store the raw mode reads the claim's entry out of. */
  repoId: string;
  claim: GuardClaimRow;
  /** The decisions ledger, when the page offers the ruling. */
  decisions?: GuardDecisionsState;
  /** Jump to the document this claim states. */
  onOpenDoc: (doc: string) => void;
  /** Open one flow's own page. */
  onOpenFlow: (flowId: string) => void;
}) {
  const { mode, setMode, raw } = useArtifactMode('JSON');
  const rawSource = useGuardArtifactRaw(repoId, 'claim', claim.id, raw);

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="min-w-0 border-b border-border bg-card px-6 py-4">
        <ArtifactModeSwitch format="JSON" mode={mode} onSelect={setMode} className="float-right ml-2" />
        <GuardStatusBadge status={claim.status} />
        <h2 className="mt-1 break-words text-sm font-semibold text-foreground">{claim.claim}</h2>
        {claim.reason && (
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {claim.needsSetup ? guardNeedsSetupNeed(claim.needsSetup) : claim.reason}
          </p>
        )}
        <SourceLine doc={claim.doc} onOpenDoc={onOpenDoc} />
      </div>

      <div className="min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-6 py-4">
        {raw ? (
          <ArtifactRaw content={rawSource.content} label="claim source" />
        ) : (
          <>
            {claim.verifyVia && (
              <div>
                <div className={LABEL}>Verify via</div>
                <p className="text-[12px] leading-relaxed text-muted-foreground">{claim.verifyVia}</p>
              </div>
            )}

            {/* DOWN, first link: the flows that carry the claim, each with its own word. */}
            <div>
              <div className={LABEL}>Carried by flows</div>
              {claim.flows.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">No flow carries this claim.</p>
              ) : (
                <div className="flex flex-col items-start gap-1">
                  {claim.flows.map((flow) => (
                    <button key={flow.flowId} type="button" onClick={() => onOpenFlow(flow.flowId)} className={REF_BTN}>
                      <GuardFlowStatusChip status={guardPlainStatus(flow.status)} />
                      <span className="truncate text-foreground">{flow.title}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {milestoneList(flow.milestoneOrders)}
                        {flow.milestoneCount > 0 ? ` of ${flow.milestoneCount}` : ''}
                      </span>
                      <ArrowUpRight className="h-3 w-3 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* DOWN, second link: the steps that actually observe it. */}
            {claim.scenarios.length > 0 && (
              <div>
                <div className={LABEL}>Proven by scenarios</div>
                <div className="flex flex-col items-start gap-1">
                  {claim.scenarios.map((scenario) => (
                    // Not a link: a test is read inside its flow, and the flows that
                    // carry this claim are listed right above.
                    <div key={scenario.scenarioId} className={REF_ROW}>
                      <FlaskConical className="h-3 w-3 shrink-0" />
                      <span className="truncate">{scenario.title}</span>
                      <span className="shrink-0 text-muted-foreground">{stepList(scenario.steps)}</span>
                      {scenario.outcome && <span className="shrink-0 text-muted-foreground">· {scenario.outcome}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {decisions && (
              <div>
                <div className={LABEL}>Ruling</div>
                <ClaimRuling claim={claim} decisions={decisions} />
              </div>
            )}

            <dl className="space-y-1 border-t border-border pt-3 text-[11px]">
              <div className="flex min-w-0 items-baseline gap-2">
                <dt className="w-16 shrink-0 text-muted-foreground">Claim</dt>
                <dd className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{claim.id}</dd>
              </div>
              <div className="flex min-w-0 items-baseline gap-2">
                <dt className="w-16 shrink-0 text-muted-foreground">Content</dt>
                <dd className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                  <HoverPopover portal width="narrow" content="Hash over the claim's text and where it was read from, what tells a re-generate the source moved.">
                    <span className="underline decoration-dotted underline-offset-2">{claim.contentHash}</span>
                  </HoverPopover>
                </dd>
              </div>
            </dl>
          </>
        )}
      </div>
    </div>
  );
}

/** A statement the scan judged untestable: what it said, why, where it came from. */
export function GuardUntestableDetail({
  row,
  onOpenDoc,
}: {
  row: GuardUntestableRow;
  onOpenDoc: (doc: string) => void;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="min-w-0 border-b border-border bg-card px-6 py-4">
        <HoverPopover
          portal
          width="wide"
          content="Nothing about this statement can be observed by running the product, so the scan wrote no claim rather than inventing a test for it."
        >
          <span className={`${CHIP} bg-muted text-muted-foreground underline decoration-dotted underline-offset-2`}>
            Not testable
          </span>
        </HoverPopover>
        <h2 className="mt-1 break-words text-sm font-semibold text-foreground">{row.text}</h2>
        <SourceLine doc={row.doc} onOpenDoc={onOpenDoc} />
      </div>
      <div className="min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-6 py-4">
        <div>
          <div className={LABEL}>Why it is not a claim</div>
          <p className="text-[13px] leading-relaxed text-foreground">{row.reason}</p>
        </div>
      </div>
    </div>
  );
}
