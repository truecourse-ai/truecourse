/**
 * The compact totals strip at the top of the coverage surface — one small chip
 * per non-zero status (a coloured dot + count + label). Clicking a chip filters
 * the doc to that status (dims the rest and jumps to the first match); clicking
 * the active chip clears the filter. Mirrors the VerifyStats strip look and the
 * drift filters' toggle-off-on-reclick behaviour.
 *
 * The chips split into two labelled clusters by DRIVER SCOPE so postponements
 * never read as verdicts: the **CLI** cluster (verdicts of guarding via today's
 * only driver — passing/failing/error/stale, guarded, and the coverage gaps),
 * then a subtle divider, then **Other drivers** (sections waiting for drivers
 * that don't exist yet — API/web/TUI). Zero-count chips (and an empty cluster's
 * label + divider) stay hidden.
 *
 * The `blocked-on` chip is expandable: when it is the active filter, the strip
 * reveals the per-capability breakdown of the doc's blocked-on sections (the
 * tally that used to live in the generate Report — moved here, since it explains
 * the current grey sections).
 *
 * The `needs-setup` chip (item 65) is the same idea one step more actionable: it
 * is the slice of "blocked" the user can clear today, painted orange rather than
 * grey, and ITS expansion is a list of SERVICES ("open-meteo — 3 sections") each
 * linking to the External APIs page that provides one.
 */

import { ArrowUpRight, Eye, EyeOff } from 'lucide-react';
import { guardDriver, guardSetupServiceLabel, runnableDriverIds } from '@truecourse/shared';
import type { GuardSectionCoverageStatus } from '@truecourse/shared';
import type { CoverageFilterMode } from './GuardDocCoverage';
import { HoverPopover } from '@/components/ui/hover-popover';
import { GUARD_STATUS_ORDER, guardStatusMeta } from '@/lib/guard-status';
import type { BlockedOnEntry, NeedsSetupEntry } from '@/lib/guard-report';
import { GUARD_REGENERATE_COMMAND } from '@/lib/guard-flow-status';

// The CLI cluster's label + hover, computed from the runnable driver registry so
// the copy stays truthful as drivers ship (one runnable driver ⇒ "today's only
// driver"). `group === 'driver'` chips are the awaiting drivers; everything else
// is a CLI-driver verdict.
const RUNNABLE_LABEL = runnableDriverIds.map((id) => guardDriver(id)?.label ?? id).join(', ');
const CLI_CLUSTER_HOVER = `Verdicts of guarding these sections via the ${RUNNABLE_LABEL} driver${
  runnableDriverIds.length === 1 ? " — today's only driver" : 's'
}.`;

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
  activeFilter: GuardSectionCoverageStatus | null;
  onFilter: (status: GuardSectionCoverageStatus | null) => void;
  /** Blur (dim) vs hide (collapse) the sections the active filter excludes. */
  filterMode: CoverageFilterMode;
  onFilterModeChange: (mode: CoverageFilterMode) => void;
  /** Per-capability tally of the doc's `blocked-on` sections — the chip's expansion. */
  blockedOnCapabilities?: BlockedOnEntry[];
  /** Per-service tally of the doc's `needs-setup` sections — that chip's expansion. */
  needsSetupServices?: NeedsSetupEntry[];
  /** Jump to the External APIs page — the needs-setup rows' CTA. */
  onOpenExternals?: () => void;
}) {
  const nonZero = GUARD_STATUS_ORDER.filter((s) => totals[s] > 0);
  // Split by driver scope: CLI verdicts vs sections awaiting a future driver.
  const cliChips = nonZero.filter((s) => guardStatusMeta(s).group !== 'driver');
  const driverChips = nonZero.filter((s) => guardStatusMeta(s).group === 'driver');
  const totalSections = nonZero.reduce((n, s) => n + totals[s], 0);
  const showBlockedBreakdown = activeFilter === 'blocked-on' && blockedOnCapabilities.length > 0;
  const showNeedsSetupBreakdown = activeFilter === 'needs-setup' && needsSetupServices.length > 0;

  if (nonZero.length === 0) {
    return (
      <div className="flex items-center border-b border-border px-3 py-2 text-[11px] text-muted-foreground">
        No sections in this document.
      </div>
    );
  }

  const renderChip = (status: GuardSectionCoverageStatus) => {
    const meta = guardStatusMeta(status);
    const active = activeFilter === status;
    const expandable =
      (status === 'blocked-on' && blockedOnCapabilities.length > 0) ||
      (status === 'needs-setup' && needsSetupServices.length > 0);
    return (
      <HoverPopover portal
        width="narrow"
        key={status}
        content={
          active
            ? 'Click to clear the filter'
            : expandable
              ? `Show only ${meta.label} sections and the ${
                  status === 'needs-setup' ? 'service' : 'capability'
                } breakdown`
              : `Show only ${meta.label} sections`
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
          <span className="font-medium text-foreground">{totals[status]}</span>
          <span>{meta.label}</span>
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

        {cliChips.length > 0 && (
          <div role="group" aria-label={RUNNABLE_LABEL} className="flex flex-wrap items-center gap-1.5">
            <HoverPopover portal width="narrow" content={CLI_CLUSTER_HOVER}>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {RUNNABLE_LABEL}
              </span>
            </HoverPopover>
            {cliChips.map(renderChip)}
          </div>
        )}

        {driverChips.length > 0 && (
          <>
            <span aria-hidden className="mx-0.5 h-4 w-px self-center bg-border" />
            <div role="group" aria-label="Other drivers" className="flex flex-wrap items-center gap-1.5">
              <HoverPopover portal width="narrow" content="Sections waiting for drivers that don't exist yet — postponements, not verdicts.">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Other drivers
                </span>
              </HoverPopover>
              {driverChips.map(renderChip)}
            </div>
          </>
        )}

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
                  : `Provide ${guardSetupServiceLabel(service)} on the External APIs page and these ${count} section${count === 1 ? '' : 's'} author automatically.`
              }
            >
              <button
                type="button"
                onClick={onOpenExternals}
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
