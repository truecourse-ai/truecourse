// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's apps/dashboard/client/src/components/guard/GuardClaimDetail.tsx; delete with the preview.
/**
 * ONE claim, read in both directions.
 *
 *   UP    the doc section that states it, the claim is a quotation, and the
 *         quotation has a source a reader can open.
 *   DOWN  what proves it, the flows that carry it (with the milestone position
 *         each one proves it at, each a click into that flow) and the scenarios
 *         whose steps name it (with the step numbers), read as plain rows: a test
 *         lives inside its flow, which the list above already opens.
 *
 * Between the two: the claim SENTENCE itself and how it is meant to be verified.
 * Nothing else, a claim carries no state, so the page states no verdict about
 * it: what stands behind it IS the two traces, and a reader who finds both empty
 * has read the whole answer. The content hash closes the page as a machine
 * detail, because that is all it is.
 *
 * A claim's truth is its entry in `scenarios/claims.json`, so the header carries
 * the same two-mode switch every artifact-backed entity has: this page, or that
 * entry verbatim ({@link ArtifactModeSwitch}).
 *
 * A refused statement ({@link GuardUntestableDetail}) is the same page minus
 * everything it doesn't have: the text, why extraction refused it, and the section
 * it came from. It carries NO mode switch, a refused statement has no id, so
 * nothing in the store addresses it and there is no entry to show.
 */

import { ArrowUpRight, FileText, FlaskConical } from 'lucide-react';
import type { GuardClaimRow, GuardUntestableRow } from '@/preview/vendor/shared';
import { ArtifactModeSwitch, ArtifactRaw, useArtifactMode } from '@/preview/ui/artifact-view';
import { HoverPopover } from '@/preview/ui/hover-popover';
import { useGuardArtifactRaw } from '@/preview/vendor/hooks/useGuardArtifactRaw';

const LABEL = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground';
const CHIP = 'inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[10px] font-medium';
const REF_BTN =
  'inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-left text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground';
/** The same row, with nowhere to go, a fact about the claim, not a destination. */
const REF_ROW =
  'inline-flex max-w-full items-center gap-1 rounded border border-border px-1.5 py-0.5 text-left text-[11px] text-muted-foreground';

/** "step 3" / "steps 3, 5", which observations carry the claim's tag. */
function stepList(steps: readonly number[]): string {
  if (steps.length === 0) return 'no step';
  return `${steps.length === 1 ? 'step' : 'steps'} ${steps.join(', ')}`;
}

/**
 * The source line: the doc + section this claim was read out of, as the one jump
 * back to the prose. An anchor the live doc no longer has says so plainly, the
 * button still works (it lands on the doc), and the sentence explains why the
 * highlight may not.
 */
function SourceLine({
  doc,
  anchor,
  headingText,
  anchorLive,
  onOpenSpec,
}: {
  doc: string;
  anchor: string;
  headingText?: string;
  anchorLive: boolean;
  onOpenSpec: (doc: string, anchor: string) => void;
}) {
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => onOpenSpec(doc, anchor)} className={REF_BTN}>
        <FileText className="h-3 w-3 shrink-0" />
        <span className="truncate">{headingText ?? anchor}</span>
        <span className="truncate text-muted-foreground">· {doc}</span>
        <ArrowUpRight className="h-3 w-3 shrink-0" />
      </button>
      {!anchorLive && (
        <p className="mt-1 text-[11px] text-muted-foreground">
          The anchor <code className="rounded bg-muted px-1 py-0.5">{anchor}</code> no longer resolves in the live
          document, the section it was read from was renamed or removed.
        </p>
      )}
    </div>
  );
}

export function GuardClaimDetail({
  repoId,
  claim,
  prRef,
  onOpenSpec,
  onOpenFlow,
}: {
  /** Whose store the raw mode reads the claim's entry out of. */
  repoId: string;
  claim: GuardClaimRow;
  /** The PR head the raw read is scoped to (EE); absent = the repo baseline. */
  prRef?: string;
  /** Jump to the doc section this claim states (`?doc=`+`?section=`). */
  onOpenSpec: (doc: string, anchor: string) => void;
  /** Jump to the Tests tab with one flow's detail open (`?flow=`). */
  onOpenFlow: (flowId: string) => void;
}) {
  const { mode, setMode, raw } = useArtifactMode('JSON');
  const rawSource = useGuardArtifactRaw(repoId, 'claim', claim.id, raw, prRef);

  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="min-w-0 border-b border-border bg-card px-6 py-4">
        <ArtifactModeSwitch format="JSON" mode={mode} onSelect={setMode} className="float-right ml-2" />
        <h2 className="break-words text-sm font-semibold text-foreground">{claim.title}</h2>
        <SourceLine
          doc={claim.doc}
          anchor={claim.anchor}
          {...(claim.headingText ? { headingText: claim.headingText } : {})}
          anchorLive={claim.anchorLive}
          onOpenSpec={onOpenSpec}
        />
      </div>

      <div className="min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-6 py-4">
        {raw ? (
          <ArtifactRaw content={rawSource.content} label="claim source" />
        ) : (
          <>
        {/* The sentence itself, everything else on the page is about THIS. */}
        <div>
          <div className={LABEL}>The claim</div>
          <p className="text-[13px] leading-relaxed text-foreground">{claim.claim}</p>
        </div>

        {claim.verifyVia && (
          <div>
            <div className={LABEL}>Verify via</div>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{claim.verifyVia}</p>
          </div>
        )}

        {/* DOWN, first link: the flows that carry the claim, at the milestone
            position each one proves it at. */}
        <div>
          <div className={LABEL}>Carried by flows</div>
          {claim.flows.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No flow carries this claim.</p>
          ) : (
            <div className="flex flex-col items-start gap-1">
              {claim.flows.map((flow) => (
                <button
                  key={`${flow.flowId}-${flow.milestoneOrder}`}
                  type="button"
                  onClick={() => onOpenFlow(flow.flowId)}
                  className={REF_BTN}
                >
                  <FlaskConical className="h-3 w-3 shrink-0" />
                  <span className="truncate">{flow.title}</span>
                  <span className="shrink-0 text-muted-foreground">milestone {flow.milestoneOrder}</span>
                  {flow.note && <span className="truncate text-muted-foreground">· {flow.note}</span>}
                  <ArrowUpRight className="h-3 w-3 shrink-0" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* DOWN, second link: the steps that actually observe it. */}
        <div>
          <div className={LABEL}>Proven by scenarios</div>
          {claim.scenarios.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No scenario step names this claim yet.</p>
          ) : (
            <div className="flex flex-col items-start gap-1">
              {claim.scenarios.map((scenario) => (
                // Not a link: a test is read inside its flow, and the flows that
                // carry this claim are listed right above.
                <div key={scenario.scenarioId} className={REF_ROW}>
                  <FlaskConical className="h-3 w-3 shrink-0" />
                  <span className="truncate">{scenario.title}</span>
                  <span className="shrink-0 text-muted-foreground">{stepList(scenario.steps)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <dl className="space-y-1 border-t border-border pt-3 text-[11px]">
          <div className="flex min-w-0 items-baseline gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">Claim</dt>
            <dd className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{claim.id}</dd>
          </div>
          <div className="flex min-w-0 items-baseline gap-2">
            <dt className="w-16 shrink-0 text-muted-foreground">Content</dt>
            <dd className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
              <HoverPopover portal width="narrow" content="Hash over the section text this claim was extracted from, what tells a re-generate the source moved.">
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

/** A statement extraction refused: what it said, why it was refused, where it came from. */
export function GuardUntestableDetail({
  row,
  onOpenSpec,
}: {
  row: GuardUntestableRow;
  onOpenSpec: (doc: string, anchor: string) => void;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-background">
      <div className="min-w-0 border-b border-border bg-card px-6 py-4">
        <HoverPopover
          portal
          width="wide"
          content="Nothing about this statement can be observed by running the product, so extraction wrote no claim rather than inventing a test for it."
        >
          <span className={`${CHIP} bg-muted text-muted-foreground underline decoration-dotted underline-offset-2`}>
            Not claimed
          </span>
        </HoverPopover>
        <h2 className="mt-1 break-words text-sm font-semibold text-foreground">{row.text}</h2>
        <SourceLine
          doc={row.doc}
          anchor={row.anchor}
          {...(row.headingText ? { headingText: row.headingText } : {})}
          anchorLive={row.anchorLive}
          onOpenSpec={onOpenSpec}
        />
      </div>
      <div className="min-w-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden px-6 py-4">
        <div>
          <div className={LABEL}>Why it is not claimed</div>
          <p className="text-[13px] leading-relaxed text-foreground">{row.reason}</p>
        </div>
      </div>
    </div>
  );
}
