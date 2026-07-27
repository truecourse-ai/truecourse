/**
 * Pure formatters for the flow-led guard surfaces — `guard flows`, the
 * `guard generate` summary, and the flow instance a failing `guard run` prints.
 * Kept out of the command files so both can render a milestone the same way and
 * the shapes are unit-testable without a store.
 */

import type { GuardFlowMilestone, GuardManifestGap } from "@truecourse/shared";
import { guardGapLabel } from "@truecourse/shared";

/** Milestone glyphs — the same paint the dashboard's flow instance uses. */
const PASSED = "✓";
const FAILED = "✗";

/**
 * A milestone's short display name: its claim title, whitespace-collapsed and
 * clipped so a four-milestone chain still fits one terminal row. Claim titles are
 * sentences ("Creating a task returns it with an id"); the chain reads as a path,
 * not as prose, so the clip is aggressive on purpose.
 */
export function milestoneLabel(claimTitle: string, max = 22): string {
  const text = claimTitle.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** `1 create → 2 listed → 3 complete` — the milestone chain of a flow, in order. */
export function milestoneChain(milestones: readonly GuardFlowMilestone[], max = 22): string {
  return [...milestones]
    .sort((a, b) => a.order - b.order)
    .map((m) => `${m.order} ${milestoneLabel(m.claimTitle, max)}`)
    .join(" → ");
}

/**
 * The FLOW INSTANCE of a run: `create ✓ ── listed ✓ ── complete ✗ ── done filter
 * · not reached`. Milestones before the failure passed, the failing one is
 * marked, and everything after it never executed (one trailing annotation, not a
 * glyph per milestone — the run simply stopped). Returns null when the failure
 * can't be projected onto the path (no milestone annotation, or an out-of-range
 * one), so the caller falls back to the step line.
 */
export function flowInstanceLine(
  milestones: readonly GuardFlowMilestone[],
  failedMilestone: number | undefined,
  max = 18,
): string | null {
  if (!failedMilestone) return null;
  const ordered = [...milestones].sort((a, b) => a.order - b.order);
  if (ordered.length === 0) return null;
  if (!ordered.some((m) => m.order === failedMilestone)) return null;

  let notReached = false;
  const parts = ordered.map((m) => {
    const name = milestoneLabel(m.claimTitle, max);
    if (m.order < failedMilestone) return `${name} ${PASSED}`;
    if (m.order === failedMilestone) return `${name} ${FAILED}`;
    notReached = true;
    return name;
  });
  return `${parts.join(" ── ")}${notReached ? " · not reached" : ""}`;
}

/**
 * A gap as a per-surface CHIP (`web awaiting driver`): the surface is already the
 * chip's prefix, so the driver name never repeats inside the label.
 */
export function gapChipLabel(gap: GuardManifestGap): string {
  return gap.kind === "awaiting-driver" ? "awaiting driver" : gap.kind.replace(/-/g, " ");
}

/** A gap as its own line: `web: awaiting web driver — <reason>`. */
export function gapLine(gap: GuardManifestGap): string {
  const label = guardGapLabel(gap.kind, gap.driver);
  const reason = gap.reason.replace(/\s+/g, " ").trim();
  const detail = reason && reason.toLowerCase() !== label ? ` — ${clip(reason, 80)}` : "";
  return `${gap.surface}: ${label}${detail}`;
}

/** Collapse whitespace and clip a free-text string to one readable fragment. */
export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}
