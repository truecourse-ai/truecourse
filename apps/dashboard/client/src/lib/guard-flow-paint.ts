/**
 * How a flow's milestone chain is PAINTED — the one place both paint modes of
 * {@link GuardMilestoneGraph} are derived, so the Flows tab (generate state) and
 * the Runs tab (execution state) can never disagree about what a node means.
 *
 *  - generate paint — what the last generate made of each milestone: `settled`
 *    (a scenario realizes the flow), `finding` (a birth/fidelity finding broke
 *    here), `drifted` (the bound section was edited or is gone), `awaiting` (the
 *    flow's surfaces wait on a driver), `gap` (nothing realizes it);
 *  - run paint — a run result is an INSTANCE of its flow: `pass` up to the
 *    failure, `fail` at `failedMilestone`, `not-reached` after it, and `plumbing`
 *    for every node when the failure carries no milestone at all (setup/boot, or a
 *    plumbing step) — we never claim a milestone passed on that evidence.
 *
 * Colour is never the only signal: every paint carries a glyph and a label.
 */

import { guardFindingClass } from '@truecourse/shared';
import type {
  GuardBirthFinding,
  GuardFlowMilestoneView,
  GuardFlowScenarioRow,
  GuardOutcome,
} from '@truecourse/shared';

export type GuardMilestonePaint =
  | 'settled'
  | 'finding'
  | 'drifted'
  | 'awaiting'
  | 'gap'
  | 'pass'
  | 'fail'
  | 'not-reached'
  | 'plumbing';

export interface GuardPaintMeta {
  /** Glyph rendered inside the node — the non-colour signal. */
  glyph: string;
  /** Accessible/one-line name of the state. */
  label: string;
  /** Text colour (light + dark) — shared by the node glyph and the legend. */
  text: string;
  /** Node ring (+ fill) classes; the text colour is appended by the renderer. */
  node: string;
  /** The connector segment LEADING INTO this node. */
  line: string;
}

const EMERALD = 'text-emerald-600 dark:text-emerald-400';
const RED = 'text-red-600 dark:text-red-400';
const AMBER = 'text-amber-600 dark:text-amber-400';
const MUTED = 'text-muted-foreground';
const NEUTRAL_LINE = 'bg-border';
const DASHED_LINE = 'bg-transparent border-t-2 border-dashed border-muted-foreground/40';

export const GUARD_PAINT_META: Record<GuardMilestonePaint, GuardPaintMeta> = {
  settled: {
    glyph: '●',
    label: 'settled',
    text: EMERALD,
    node: 'border-emerald-500',
    line: 'bg-emerald-500/60',
  },
  finding: {
    glyph: '▲',
    label: 'failing',
    text: RED,
    node: 'border-red-500',
    line: 'bg-red-500/60',
  },
  drifted: {
    glyph: '~',
    label: 'section drifted',
    text: AMBER,
    node: 'border-amber-500',
    line: 'bg-amber-500/60',
  },
  awaiting: {
    glyph: '◌',
    label: 'awaiting driver',
    text: MUTED,
    node: 'border-dashed border-slate-400',
    line: NEUTRAL_LINE,
  },
  gap: {
    glyph: '○',
    label: 'gap',
    text: MUTED,
    node: 'border-slate-400/70',
    line: NEUTRAL_LINE,
  },
  pass: {
    glyph: '✓',
    label: 'pass',
    text: EMERALD,
    node: 'border-emerald-500 bg-emerald-500/10',
    line: 'bg-emerald-500/70',
  },
  fail: {
    glyph: '✗',
    label: 'fail',
    text: RED,
    node: 'border-red-500 bg-red-500/10',
    // The segment INTO the failing node is the passing stretch before it.
    line: 'bg-emerald-500/70',
  },
  'not-reached': {
    glyph: '·',
    label: 'not reached',
    text: MUTED,
    node: 'border-dashed border-muted-foreground/50',
    line: DASHED_LINE,
  },
  plumbing: {
    glyph: '○',
    label: 'no milestone reached',
    text: MUTED,
    node: 'border-muted-foreground/40',
    line: NEUTRAL_LINE,
  },
};

/** One node of the graph — the shape both paint modes produce. */
export interface GuardMilestoneNode {
  order: number;
  /** The claim the milestone asserts (the node's caption). */
  title: string;
  paint: GuardMilestonePaint;
  doc?: string;
  anchor?: string;
  /** The live heading text, when the anchor still resolves. */
  headingText?: string;
}

/**
 * GENERATE paint — the flow detail's milestone chain. A finding wins over
 * everything (it names the exact milestone that broke), then section drift, then
 * whether any surface actually realizes the flow.
 */
export function generatePaintNodes(
  milestones: readonly GuardFlowMilestoneView[],
  surfaces: readonly GuardFlowScenarioRow[],
  findings: readonly GuardBirthFinding[],
): GuardMilestoneNode[] {
  // Only a finding that says the REPO is wrong paints a milestone red. A withheld
  // generation defect / fidelity rejection is our own (item 85, F3): nothing was
  // committed and nothing here is broken, so painting its milestone as a failure
  // would report drift that does not exist. The flow carries a muted marker instead.
  const broken = new Set(
    findings
      .filter((f) => guardFindingClass(f) !== 'defect')
      .map((f) => f.failedMilestone)
      .filter((m): m is number => typeof m === 'number'),
  );
  const realized = surfaces.some((s) => s.scenarioId != null);
  const awaiting = !realized && surfaces.some((s) => s.gap?.kind === 'awaiting-driver');
  const base: GuardMilestonePaint = realized ? 'settled' : awaiting ? 'awaiting' : 'gap';

  return milestones.map((m) => ({
    order: m.order,
    title: m.claimTitle,
    doc: m.doc,
    anchor: m.anchor,
    headingText: m.headingText,
    paint: broken.has(m.order) ? 'finding' : m.drifted || !m.live ? 'drifted' : base,
  }));
}

/**
 * RUN paint — a result rendered as an instance of its flow. `failedMilestone` is
 * the pivot: everything before it passed, it broke, everything after was never
 * reached. Without one (a setup/boot failure, or a plumbing step with no
 * milestone) nothing can be claimed, so every node paints neutral.
 */
export function runPaintNodes(
  milestones: readonly { order: number; claimTitle: string; doc?: string; anchor?: string }[],
  outcome: GuardOutcome,
  failedMilestone?: number,
): GuardMilestoneNode[] {
  const paintFor = (order: number): GuardMilestonePaint => {
    if (outcome === 'pass') return 'pass';
    if (outcome === 'stale' || outcome === 'orphaned') return 'not-reached';
    if (failedMilestone == null) return 'plumbing';
    if (order < failedMilestone) return 'pass';
    if (order === failedMilestone) return 'fail';
    return 'not-reached';
  };
  return milestones.map((m) => ({
    order: m.order,
    title: m.claimTitle,
    doc: m.doc,
    anchor: m.anchor,
    paint: paintFor(m.order),
  }));
}
