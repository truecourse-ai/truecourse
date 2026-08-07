/**
 * The compact totals strip at the top of the coverage surface — one small chip
 * per non-zero COVERAGE STATUS (a coloured dot + count + word). Clicking a chip
 * filters the doc to that status (dims the rest and jumps to the first match);
 * clicking the active chip clears the filter. Mirrors the VerifyStats strip look
 * and the drift filters' toggle-off-on-reclick behaviour.
 *
 * There are exactly FIVE chips, ever — Failed, Blocked, Never run, Succeeded, Not
 * testable — because a counter is a coverage status and a coverage status is one
 * of five words. The wire's richer status ids fold into them
 * (`guardCoveragePlainStatus`), which is what keeps a reader from having to hold
 * nineteen gap kinds in their head to read one strip. Zero-count chips stay hidden.
 *
 * WHICH blocker is behind the Blocked count is a DETAIL, not a counter: making
 * Blocked the active filter reveals it — the per-capability breakdown of the
 * doc's blocked-on sections, and the per-SERVICE list of the ones a user can clear
 * today ("open-meteo — 3 sections"), each linking to the External APIs page that
 * provides one.
 */

import { ArrowUpRight, Eye, EyeOff } from 'lucide-react';
import {
  GUARD_COVERAGE_PLAIN_ORDER,
  GUARD_COVERAGE_STATUS_WORD,
  MISSING_DATA_NOUN,
  guardCoveragePlainStatus,
  guardSetupServiceLabel,
} from '@truecourse/shared';
import type { GuardCoveragePlainStatus, GuardSectionCoverageStatus } from '@truecourse/shared';
import type { CoverageFilterMode } from './GuardDocCoverage';
import { HoverPopover } from '@/components/ui/hover-popover';
import { guardStatusMeta } from '@/lib/guard-status';
import type { BlockedOnEntry, NeedsSetupEntry } from '@/lib/guard-report';
import { GUARD_REGENERATE_COMMAND } from '@/lib/guard-flow-status';

/** The wire status each chip borrows its swatch from — the same source the doc
 *  bands use, so a chip's dot and the sections it selects share one colour. */
const CHIP_COLOUR_SOURCE: Record<GuardCoveragePlainStatus, GuardSectionCoverageStatus> = {
  failed: 'fail',
  blocked: 'blocked-on',
  'never-run': 'never-run',
  succeeded: 'pass',
  'not-testable': 'untestable',
};

export function GuardTotalsStrip({
  totals,
  activeFilter,
  onFilter,
  filterMode,
  onFilterModeChange,
  blockedOnCapabilities = [],
  needsSetupServices = [],
  onOpenExternals,
}: {
  totals: Record<GuardSectionCoverageStatus, number>;
  activeFilter: GuardCoveragePlainStatus | null;
  onFilter: (status: GuardCoveragePlainStatus | null) => void;
  /** Blur (dim) vs hide (collapse) the sections the active filter excludes. */
  filterMode: CoverageFilterMode;
  onFilterModeChange: (mode: CoverageFilterMode) => void;
  /** Per-capability tally of the doc's `blocked-on` sections — the chip's expansion. */
  blockedOnCapabilities?: BlockedOnEntry[];
  /** Per-service tally of the doc's `needs-setup` sections — that chip's expansion. */
  needsSetupServices?: NeedsSetupEntry[];
  /** Jump to the External APIs page, on the named service's card — the needs-setup rows' CTA. */
  onOpenExternals?: (service?: string) => void;
}) {
  // Every wire status folded onto its word, so the chips are the five and the
  // counts still add up to the document's sections.
  const counts = {} as Record<GuardCoveragePlainStatus, number>;
  for (const key of GUARD_COVERAGE_PLAIN_ORDER) counts[key] = 0;
  for (const [status, n] of Object.entries(totals) as [GuardSectionCoverageStatus, number][]) {
    counts[guardCoveragePlainStatus(status)] += n;
  }
  const nonZero = GUARD_COVERAGE_PLAIN_ORDER.filter((s) => counts[s] > 0);
  const totalSections = nonZero.reduce((n, s) => n + counts[s], 0);
  const showBlockedBreakdown = activeFilter === 'blocked' && blockedOnCapabilities.length > 0;
  const showNeedsSetupBreakdown = activeFilter === 'blocked' && needsSetupServices.length > 0;

  if (nonZero.length === 0) {
    return (
      <div className="flex items-center border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        No sections in this document.
      </div>
    );
  }

  const renderChip = (status: GuardCoveragePlainStatus) => {
    const meta = guardStatusMeta(CHIP_COLOUR_SOURCE[status]);
    const word = GUARD_COVERAGE_STATUS_WORD[status];
    const active = activeFilter === status;
    const expandable =
      status === 'blocked' && (blockedOnCapabilities.length > 0 || needsSetupServices.length > 0);
    return (
      <HoverPopover portal
        width="narrow"
        key={status}
        content={
          active
            ? 'Click to clear the filter'
            : expandable
              ? `Show only ${word} sections and what they are waiting on`
              : `Show only ${word} sections`
        }
      >
        <button
          type="button"
          aria-pressed={active}
          onClick={() => onFilter(active ? null : status)}
          className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] transition-colors ${
            active
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground'
          }`}
        >
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          <span className="font-medium text-foreground">{counts[status]}</span>
          <span>{word}</span>
        </button>
      </HoverPopover>
    );
  };

  return (
    <div className="border-b border-border">
      <div
        role="group"
        aria-label="Coverage totals"
        className="flex flex-wrap items-center gap-1.5 px-3 py-2"
      >
        <span className="mr-1 text-[11px] font-medium text-muted-foreground">
          {totalSections} section{totalSections === 1 ? '' : 's'}
        </span>

        {nonZero.map(renderChip)}

        {activeFilter && (
          <div
            role="group"
            aria-label="Filter display mode"
            className="ml-auto flex items-center gap-0.5 rounded border border-border p-0.5"
          >
            {(
              [
                { mode: 'blur', icon: Eye, label: 'Blur', help: 'Dim non-matching sections in place' },
                { mode: 'hide', icon: EyeOff, label: 'Hide', help: 'Collapse non-matching sections' },
              ] as const
            ).map(({ mode, icon: Icon, label, help }) => {
              const active = filterMode === mode;
              return (
                <HoverPopover portal key={mode} content={help}>
                  <button
                    type="button"
                    aria-pressed={active}
                    aria-label={label}
                    onClick={() => onFilterModeChange(mode)}
                    className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] transition-colors ${
                      active
                        ? 'bg-primary/10 text-foreground'
                        : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                    }`}
                  >
                    <Icon className="h-3 w-3" />
                    {label}
                  </button>
                </HoverPopover>
              );
            })}
          </div>
        )}
      </div>

      {showNeedsSetupBreakdown && (
        <div
          role="group"
          aria-label="Needs setup"
          className="flex flex-wrap items-center gap-1.5 border-t border-orange-500/30 bg-orange-500/[0.07] px-3 py-1.5"
        >
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-orange-600 dark:text-orange-400">
            Needs setup
          </span>
          {needsSetupServices.map(({ service, count, provided }) => (
            <HoverPopover
              portal
              width="narrow"
              key={service}
              content={
                provided
                  ? `${guardSetupServiceLabel(service)} is already provided — run \`${GUARD_REGENERATE_COMMAND}\` to author these ${count} section${count === 1 ? '' : 's'}.`
                  : service === MISSING_DATA_NOUN
                    ? `The seed script doesn’t create the data these ${count} section${count === 1 ? '' : 's'} need — extend it, then re-run \`${GUARD_REGENERATE_COMMAND}\`.`
                    : `Provide ${guardSetupServiceLabel(service)} on the External APIs page and these ${count} section${count === 1 ? '' : 's'} author automatically.`
              }
            >
              <button
                type="button"
                // The row IS the service, so the jump names it and the page opens
                // its card. The one synthetic key has no card — it lands the tab.
                onClick={() => onOpenExternals?.(service === MISSING_DATA_NOUN ? undefined : service)}
                disabled={!onOpenExternals}
                className="inline-flex items-center gap-1 rounded border border-orange-500/40 bg-orange-500/10 px-1.5 py-0.5 text-[11px] text-orange-700 transition-colors hover:bg-orange-500/20 disabled:cursor-default disabled:hover:bg-orange-500/10 dark:text-orange-300"
              >
                <span className="font-medium">{guardSetupServiceLabel(service)}</span>
                <span className="text-orange-600/80 dark:text-orange-400/80">
                  {count} {count === 1 ? 'section' : 'sections'}
                </span>
                {provided ? (
                  <span className="text-orange-600/80 dark:text-orange-400/80">· re-generate</span>
                ) : (
                  <ArrowUpRight className="h-3 w-3" />
                )}
              </button>
            </HoverPopover>
          ))}
          <span className="text-[10px] text-muted-foreground">
            {needsSetupServices.every((s) => s.provided)
              ? `Set up — run \`${GUARD_REGENERATE_COMMAND}\` to author these flows.`
              : needsSetupServices.every((s) => s.provided || s.service === MISSING_DATA_NOUN)
                ? `Extend the seed script to create this data, then re-run \`${GUARD_REGENERATE_COMMAND}\`.`
                : 'Provide these on the External APIs page and these flows author automatically.'}
          </span>
        </div>
      )}

      {showBlockedBreakdown && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 bg-muted/20 px-3 py-1.5">
          <span className="mr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Blocked on
          </span>
          {blockedOnCapabilities.map(({ capability, count }) => (
            <span key={capability} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-foreground">
              {capability} <span className="text-muted-foreground">{count}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
