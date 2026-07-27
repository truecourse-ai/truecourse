/**
 * The section detail side panel — opened by clicking a statused section. It tells
 * the FLOW story (the user-directed inversion): the section's status + reason,
 * then the flows that traverse it, each with its per-surface chips, the milestone
 * positions it covers, and an "open" jump into the Flows tab. Scenarios never
 * appear here — a section shows the flows that test it; the scenarios live one
 * level deeper, inside each flow.
 *
 * A flow row here is the Flows-LIST row: the same status chip and the same
 * compact surface chips, from the same vocabulary — the list a user came from and
 * the panel they land in never describe one flow with two sets of words.
 *
 * When nothing binds the section — a coverage gap (untestable / awaiting driver /
 * blocked-on) or a doc that was never generated — the pane explains that with an
 * EmptyState instead of an empty list.
 */

import { ArrowUpRight, FlaskConical, Layers, PenLine, X } from 'lucide-react';
import type { GuardSectionCoverage, GuardSectionFlow } from '@truecourse/shared';
import { EmptyState } from '@/components/ui/empty-state';
import { HoverPopover } from '@/components/ui/hover-popover';
import { guardPlainStatus } from '@/lib/guard-flow-status';
import { guardStatusMeta } from '@/lib/guard-status';
import { GuardFlowStatusChip, GuardStatusBadge } from './GuardStatusBadge';
import { GuardSurfaceChip } from './GuardSurfaceChip';

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

function GuardSectionFlowRow({
  flow,
  onOpenFlow,
}: {
  flow: GuardSectionFlow;
  onOpenFlow: (flowId: string) => void;
}) {
  const covers = milestoneRange(flow.milestonesInSection);
  return (
    <button
      type="button"
      role="listitem"
      onClick={() => onOpenFlow(flow.flowId)}
      title={`${flow.title} — open the flow`}
      className="flex w-full flex-col gap-1.5 border-b border-border/60 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex w-full items-start gap-2">
        <span className="min-w-0 flex-1 text-[13px] font-medium leading-snug text-foreground">{flow.title}</span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-primary">
          open
          <ArrowUpRight className="h-3 w-3" />
        </span>
      </div>

      {/* Exactly the Flows-list row vocabulary: the ONE status word, then the
          compact surface chips — a flow reads the same wherever it is listed. */}
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
        {flow.surfaces.map((s, i) => (
          <GuardSurfaceChip key={`${s.surface ?? 'none'}-${i}`} data={s} compact />
        ))}
      </div>

      <span className="text-[11px] leading-snug text-muted-foreground">
        {covers && flow.milestoneCount > 0
          ? `covers ${covers} of ${flow.milestoneCount}`
          : flow.manual
            ? 'hand-written test'
            : 'no milestone in this section'}
        {flow.reason ? ` · ${flow.reason}` : ''}
      </span>
    </button>
  );
}

export function GuardSectionDetail({
  section,
  onOpenFlow,
  onClose,
}: {
  section: GuardSectionCoverage;
  /** Jump into the Flows tab with this flow's detail open (`?gflow=`). */
  onOpenFlow: (flowId: string) => void;
  onClose: () => void;
}) {
  const meta = guardStatusMeta(section.status);
  const flows = section.flows ?? [];

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
      {section.blockedOnCapabilities && section.blockedOnCapabilities.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2">
          {section.blockedOnCapabilities.map((cap) => (
            <span key={cap} className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{cap}</span>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {flows.length > 0 ? (
          <div role="list" aria-label="Flows through this section">
            <div className="border-b border-border/60 px-3 py-1.5 text-[11px] text-muted-foreground">
              Flows through this section — open a flow for its tests
            </div>
            {flows.map((flow) => (
              <GuardSectionFlowRow key={flow.flowId} flow={flow} onOpenFlow={onOpenFlow} />
            ))}
          </div>
        ) : (
          <div className="px-3 pt-3">
            <EmptyState
              icon={FlaskConical}
              title={`${meta.label} — no flow`}
              body={section.reason ?? 'No flow traverses this section yet.'}
            />
          </div>
        )}
      </div>
    </aside>
  );
}
