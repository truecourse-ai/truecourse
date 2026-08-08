/**
 * The section detail side panel — opened by clicking a statused section. It tells
 * the FLOW story (the user-directed inversion): the section's status + reason,
 * then the flows that traverse it, each with its per-surface chips, the milestone
 * positions it covers, and an "open" jump into the Tests tab. Scenarios never
 * appear here — a section shows the flows that test it; the scenarios live one
 * level deeper, inside each flow.
 *
 * A flow row here is the Flows-LIST row: the same status chip and the same
 * compact surface chips, from the same vocabulary — the list a user came from and
 * the panel they land in never describe one flow with two sets of words.
 *
 * Beside the flows, ALWAYS: the section's CLAIMS. Claims are read WHERE the
 * reader already is, which is here — there is no parallel claims tab, because a
 * second surface would add navigation without adding information. Every claim the
 * section states is listed as what it is — the doc's sentence, no status of its
 * own — worst-covered first; the section's refused statements close the list.
 * Clicking a claim drills into it — the sentence, both traces (the flows that
 * carry it, the test steps that prove it) and the source line — and Back returns
 * to the section.
 *
 * When nothing binds the section — a coverage gap (untestable / awaiting driver /
 * blocked-on) or a doc that was never generated — the pane explains that with an
 * EmptyState instead of an empty list.
 */

import { ArrowLeft, ArrowUpRight, FlaskConical, Layers, PenLine, X } from 'lucide-react';
import type { GuardClaimRow, GuardSectionCoverage, GuardSectionFlow } from '@truecourse/shared';
import { MISSING_DATA_NOUN } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityList, type EntityListGroup } from '@/components/ui/entity-list';
import { HoverPopover } from '@/components/ui/hover-popover';
import {
  GUARD_SEED_INIT_COMMAND,
  guardNeedsSetupNeed,
  guardPlainStatus,
} from '@/lib/guard-flow-status';
import { guardStatusMeta } from '@/lib/guard-status';
import { sectionClaimItems, type GuardSectionClaimItem, type GuardUntestableEntry } from '@/lib/guard-claims';
import { GuardClaimDetail, GuardUntestableDetail } from './GuardClaimDetail';
import { GuardClaimGapListRow, GuardClaimListRow, GuardUntestableListRow } from './GuardClaimListRow';
import { GuardNeedsSetupCta } from './GuardNeedsSetupCta';
import { GuardFlowStatusChip, GuardStatusBadge } from './GuardStatusBadge';

/** "milestone 3" / "milestones 3–4" / "milestones 1, 3–4" — the positions in THIS section. */
function milestoneRange(orders: number[]): string {
  if (orders.length === 0) return '';
  const sorted = [...orders].sort((a, b) => a - b);
  const runs: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (const n of sorted.slice(1)) {
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    runs.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  runs.push(start === prev ? `${start}` : `${start}–${prev}`);
  return `${sorted.length === 1 ? 'milestone' : 'milestones'} ${runs.join(', ')}`;
}

/** The enumerated `missing-data` noun, as a `blocked-on` capability chip. */
function isMissingDataCapability(capability: string): boolean {
  return capability.trim().toLowerCase().replace(/\s+/g, '-') === MISSING_DATA_NOUN;
}

function GuardSectionFlowRow({ flow }: { flow: GuardSectionFlow }) {
  const covers = milestoneRange(flow.milestonesInSection);
  return (
    <>
      <div className="flex w-full items-start gap-2">
        <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-foreground">{flow.title}</span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-primary">
          open
          <ArrowUpRight className="h-3 w-3" />
        </span>
      </div>

      {/* Exactly the Flows-list row vocabulary: the ONE status word first, then
          the markers — a flow reads the same wherever it is listed. There are no
          surface chips: guard runs one surface per flow, so they said the same
          word on every row. A second surface brings back a plain label here. */}
      <div className="flex flex-wrap items-center gap-1">
        <GuardFlowStatusChip status={guardPlainStatus(flow.status)} />
        {flow.epic && (
          <HoverPopover portal width="narrow" content="Epic flow — it chains other flows end to end.">
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Layers className="h-3 w-3" />
              epic
            </span>
          </HoverPopover>
        )}
        {flow.manual && (
          <HoverPopover portal width="narrow" content="Hand-written test — it belongs to no synthesized flow.">
            <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <PenLine className="h-3 w-3" />
              manual
            </span>
          </HoverPopover>
        )}
      </div>

      <span className="text-[11px] leading-snug text-muted-foreground">
        {covers && flow.milestoneCount > 0
          ? `covers ${covers} of ${flow.milestoneCount}`
          : flow.manual
            ? 'hand-written test'
            : 'no milestone in this section'}
        {flow.needsSetup ? ` · ${guardNeedsSetupNeed(flow.needsSetup)}` : flow.reason ? ` · ${flow.reason}` : ''}
      </span>
    </>
  );
}

const CLAIMS_HELP =
  'Every testable statement this section makes, and what stands behind it. A claim nothing carries is a promise nothing tests — whatever the section’s own status says, because a section that reads Succeeded can still hold holes.';

const NOT_CLAIMED_HELP =
  'Statements the docs make that nothing can falsify — extraction refused them rather than inventing a test.';

export function GuardSectionDetail({
  repoId,
  section,
  doc = null,
  claims = [],
  untestable = [],
  activeClaimId = null,
  prRef,
  onSelectClaim,
  onOpenFlow,
  onOpenSpec,
  onOpenExternals,
  onClose,
}: {
  /** Whose store the claim drill-in reads its raw entry out of. */
  repoId: string;
  section: GuardSectionCoverage;
  /** The PR head the claim's raw read is scoped to (EE). */
  prRef?: string;
  /** The doc this section belongs to — claims are keyed doc + anchor. */
  doc?: string | null;
  /** The whole claim corpus; the section keeps the ones it states. */
  claims?: readonly GuardClaimRow[];
  /** The refused statements with the ids this panel addresses them by. */
  untestable?: readonly GuardUntestableEntry[];
  /** The claim being read (`?gclaim`), or null for the section itself. */
  activeClaimId?: string | null;
  /** Select (or clear, with null) the claim this panel drills into. */
  onSelectClaim?: (claimId: string | null) => void;
  /** Jump into the Tests tab with this flow's detail open (`?gflow=`). */
  onOpenFlow: (flowId: string) => void;
  /** Jump to a doc section — the claim detail's source line. */
  onOpenSpec?: (doc: string, anchor: string) => void;
  /** Jump to the Dependencies tab, on the named service's card — the needs-setup CTA. */
  onOpenExternals?: (service?: string) => void;
  onClose: () => void;
}) {
  const meta = guardStatusMeta(section.status);
  const flows = section.flows ?? [];
  const claimItems = sectionClaimItems(section, doc, claims, untestable);
  const active = activeClaimId ? claimItems.find((i) => i.id === activeClaimId) ?? null : null;
  const readable = active && active.kind !== 'gap' ? active : null;

  // The drill-in: one claim, read in both directions, WITHOUT leaving the doc.
  if (readable) {
    return (
      <aside className="flex h-full w-96 shrink-0 flex-col border-l border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <button
            type="button"
            onClick={() => onSelectClaim?.(null)}
            aria-label="Back to the section"
            className="inline-flex min-w-0 items-center gap-1 rounded px-1 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3 shrink-0" />
            <span className="truncate">{section.headingText || section.anchor}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close section detail"
            className="ml-auto shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {readable.kind === 'claim' ? (
            <GuardClaimDetail
              repoId={repoId}
              claim={readable.claim}
              {...(prRef ? { prRef } : {})}
              onOpenSpec={onOpenSpec ?? (() => {})}
              onOpenFlow={onOpenFlow}
            />
          ) : (
            <GuardUntestableDetail row={readable.row} onOpenSpec={onOpenSpec ?? (() => {})} />
          )}
        </div>
      </aside>
    );
  }

  const claimRows = claimItems.filter((i) => i.kind !== 'untestable');
  const refused = claimItems.filter((i) => i.kind === 'untestable');
  const claimGroups: EntityListGroup<GuardSectionClaimItem>[] = [];
  if (claimRows.length > 0) {
    claimGroups.push({
      key: 'claims',
      label: 'Claims',
      help: CLAIMS_HELP,
      count: claimRows.length,
      items: claimRows,
    });
  }
  if (refused.length > 0) {
    claimGroups.push({
      key: 'untestable',
      label: 'Not claimed',
      help: NOT_CLAIMED_HELP,
      count: refused.length,
      items: refused,
    });
  }

  return (
    <aside className="flex h-full w-96 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-start gap-2 border-b border-border px-3 py-2">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <GuardStatusBadge status={section.status} />
            <span className="text-[10px] text-muted-foreground">H{section.level}</span>
          </div>
          <h3 className="mt-1 text-sm font-semibold text-foreground">{section.headingText}</h3>
          <HoverPopover portal content="Section anchor (deep-link target)">
            <code className="mt-0.5 block truncate text-[10px] text-muted-foreground">{section.anchor}</code>
          </HoverPopover>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close section detail"
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/40 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {section.reason && (
        <div className="border-b border-border px-3 py-2 text-sm text-muted-foreground">{section.reason}</div>
      )}
      {section.needsSetup && (
        <GuardNeedsSetupCta needsSetup={section.needsSetup} onOpenExternals={onOpenExternals} />
      )}
      {section.blockedOnCapabilities && section.blockedOnCapabilities.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
          {section.blockedOnCapabilities.map((cap) => (
            <span key={cap} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{cap}</span>
          ))}
        </div>
      )}
      {/* A section still PLAIN-blocked on MISSING DATA has no seed — the
          moment one exists the gap is promoted to needs-setup above (the "setup
          done — re-run" sub-state when the seed postdates the last generate, the
          "extend the seed" one when it already fed it), so this line can only
          appear when there is a seed to draft. */}
      {!section.needsSetup && section.blockedOnCapabilities?.some(isMissingDataCapability) && (
        <p className="border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
          No seed script yet — draft one with{' '}
          <code className="rounded bg-muted px-1 py-0.5">{GUARD_SEED_INIT_COMMAND}</code>.
        </p>
      )}

      <div className="flex-1 overflow-auto">
        {flows.length > 0 ? (
          <EntityList<GuardSectionFlow>
            variant="embedded"
            label="Flows through this section"
            itemId={(flow) => flow.flowId}
            onOpen={(flowId) => onOpenFlow(flowId)}
            groups={[
              {
                key: 'flows',
                label: 'Flows through this section',
                help: 'Open a flow for the tests that run through this section.',
                count: flows.length,
                items: flows,
              },
            ]}
            renderRow={(flow) => <GuardSectionFlowRow flow={flow} />}
          />
        ) : claimItems.length === 0 ? (
          <div className="px-3 pt-3">
            <EmptyState
              icon={FlaskConical}
              title={`${meta.label} — no flow`}
              body={section.reason ?? 'No flow traverses this section yet.'}
            />
          </div>
        ) : null}

        {claimGroups.length > 0 && (
          <EntityList<GuardSectionClaimItem>
            variant="embedded"
            label="Claims in this section"
            groups={claimGroups}
            itemId={(item) => item.id}
            activeId={activeClaimId}
            // A gap that named no claim has nothing to open, so it never pretends to.
            rowInteractive={(item) => item.kind !== 'gap'}
            onOpen={(id) => onSelectClaim?.(id)}
            renderRow={(item) =>
              item.kind === 'claim' ? (
                <GuardClaimListRow claim={item.claim} />
              ) : item.kind === 'untestable' ? (
                <GuardUntestableListRow row={item.row} />
              ) : (
                <GuardClaimGapListRow gap={item.gap} />
              )
            }
          />
        )}
      </div>
    </aside>
  );
}
