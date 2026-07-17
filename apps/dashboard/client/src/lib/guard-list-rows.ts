/**
 * The Scenarios-tab LEFT-PANEL row model — committed scenarios AND birth findings
 * as one inventory. A birth finding is a section-bound artifact that failed to
 * become a guard, so it lives in the SAME doc › section grouping as scenarios
 * (the plan: "findings live in the scenario list"). Findings have no persisted
 * id, so each gets a deterministic key (`finding:<anchor>:<index-in-report>`)
 * that both the `?gscn` param and the tab identity use — stable across reloads
 * while the same generate report is on disk. Pure/client-only: the report
 * payload already carries everything.
 */

import {
  dismissedClaimKey,
  type GuardAutoResolved,
  type GuardBirthFinding,
  type GuardGenerateReport,
  type GuardSectionCoverageStatus,
} from '@truecourse/shared';
import { sectionLeaf } from '@/lib/guard-drifts';
import { guardStatusMeta } from '@/lib/guard-status';
import { guardRowStatus, type GuardScenarioRowData } from '@/hooks/useGuardScenarios';

/** The synthetic list status of a birth finding — a distinct chip, never a run outcome. */
export const FINDING_STATUS = 'finding' as const;

/** A row's list status: a real section-coverage status, or the finding pseudo-status. */
export type GuardListStatus = GuardSectionCoverageStatus | typeof FINDING_STATUS;

/** A birth finding lifted into a first-class inventory row, section-bound like a scenario. */
export interface GuardFindingRowData {
  /** Deterministic tab/URL key — `finding:<anchor>:<index-in-report>`. */
  id: string;
  /** The claim the failed candidate asserted. */
  title: string;
  doc: string;
  anchor: string;
  /**
   * The bound section's human heading — the report's server-joined `headingText`
   * (a finding's section is unsettled, so no committed scenario donates it), else a
   * co-bound scenario's; absent when neither joins (the group header then falls
   * back to the slug leaf, exactly like scenario rows).
   */
  headingText?: string;
  /** Position in `report.birthFindings` — stable while the report is on disk. */
  index: number;
  finding: GuardBirthFinding;
  /**
   * The user has already dismissed this finding's claim in `decisions.json` — the
   * report is a snapshot, so the row stays until the next generate. The panel
   * strikes it through and the detail offers Un-dismiss. `false` when the finding
   * carries no `claim` (an old report — nothing to key a dismissal on).
   */
  dismissed: boolean;
}

/** A single inventory row — a committed scenario or a birth finding. All carry
 *  `id`/`title`/`doc`/`anchor`/`headingText`, so the panel groups and labels them
 *  uniformly and only branches on `kind` for the badge + selection payload. */
export type GuardListRow =
  | ({ kind: 'scenario' } & GuardScenarioRowData)
  | ({ kind: 'finding' } & GuardFindingRowData);

/** The deterministic key for a finding at a given report index. */
export function findingKey(finding: GuardBirthFinding, index: number): string {
  return `finding:${finding.anchor}:${index}`;
}

/** Human-heading lookup keyed by `doc\0anchor`, built from scenario rows' joined text. */
function headingMap(scenarioRows: readonly GuardScenarioRowData[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of scenarioRows) {
    if (r.headingText) m.set(`${r.doc}\0${r.anchor}`, r.headingText);
  }
  return m;
}

/** Resolve a section's human heading the way scenario rows do — reuse a co-bound
 *  scenario's joined heading (doc + anchor), else fall back to the slug leaf. */
export type HeadingResolver = (doc: string, anchor: string) => string;
export function makeHeadingResolver(scenarioRows: readonly GuardScenarioRowData[]): HeadingResolver {
  const m = headingMap(scenarioRows);
  return (doc, anchor) => m.get(`${doc}\0${anchor}`) ?? sectionLeaf(anchor);
}

/** Lift a generate report's birth findings into inventory rows. The heading
 *  prefers the report's server-joined `headingText` (a finding's section is
 *  unsettled, so no co-bound scenario donates it), then the client resolver, else
 *  undefined → panel falls back to the slug. */
export function buildFindingRows(
  report: GuardGenerateReport | null,
  scenarioRows: readonly GuardScenarioRowData[],
  dismissedKeys: ReadonlySet<string> = new Set(),
): GuardFindingRowData[] {
  if (!report) return [];
  const m = headingMap(scenarioRows);
  return report.birthFindings.map((finding, index) => ({
    id: findingKey(finding, index),
    title: finding.title,
    doc: finding.doc,
    anchor: finding.anchor,
    headingText: finding.headingText ?? m.get(`${finding.doc}\0${finding.anchor}`),
    index,
    finding,
    dismissed: finding.claim
      ? dismissedKeys.has(dismissedClaimKey(finding.doc, finding.anchor, finding.claim))
      : false,
  }));
}

/** The dismissed-claim identity keys from a decisions file — `buildFindingRows`
 *  membership set. Kept here so the client keys exactly as the engine does. */
export function dismissedKeySet(
  dismissedClaims: readonly { doc: string; anchor: string; title: string }[] | undefined,
): Set<string> {
  return new Set((dismissedClaims ?? []).map((d) => dismissedClaimKey(d.doc, d.anchor, d.title)));
}

/** The re-author outcome of an item-13 fidelity-discard ledger entry. */
type GuardFidelityDiscardOutcome = Extract<GuardAutoResolved, { kind: 'fidelity-discard' }>['outcome'];

/** An auto-resolved ledger entry lifted into a muted, informational row — a
 *  high-confidence machine judgment the tool handled itself, never a task: an item-13
 *  fidelity-discard (weak scenario re-authored) or an item-14 triage auto-resolution
 *  (an `environment` claim dismissed / a `generation-defect` finding re-attempting).
 *  Not part of the filterable inventory: it renders in its own collapsed group. */
export interface GuardAutoResolvedRowData {
  /** Deterministic key — `auto:<anchor>:<index-in-report>`. */
  id: string;
  /** The auto-resolved scenario's title. */
  title: string;
  doc: string;
  anchor: string;
  /** The bound section's human heading, resolved from a co-bound scenario, else the slug leaf. */
  headingText: string;
  /** Which ledger kind — drives the badge below. */
  kind: GuardAutoResolved['kind'];
  /** The one-line explanation under the title — the fidelity mismatch or the triage brief. */
  detail: string;
  /** The right-aligned badge label + tone class describing what happened. */
  badge: { label: string; tone: string };
  /** The reviewer's mismatch — item-13 fidelity-discard rows only (kept for callers
   *  that read it directly; `detail` is the display copy). */
  mismatch?: string;
  /** The re-author outcome — item-13 fidelity-discard rows only. */
  outcome?: GuardFidelityDiscardOutcome;
}

/** The badge (label + tone) for one auto-resolved entry: a fidelity-discard shows its
 *  re-author outcome; a triage entry shows the action it took (dismissed / re-attempts). */
function autoResolvedBadge(entry: GuardAutoResolved): { label: string; tone: string } {
  if (entry.kind === 'fidelity-discard') {
    if (entry.outcome === 'resolved') return { label: 'resolved', tone: 'text-emerald-600 dark:text-emerald-400' };
    if (entry.outcome === 'finding') return { label: 'became a finding', tone: 'text-amber-600 dark:text-amber-400' };
    return { label: 'no replacement', tone: 'text-muted-foreground' };
  }
  if (entry.kind === 'triage-dismiss') return { label: 'dismissed', tone: 'text-muted-foreground' };
  return { label: 're-attempts', tone: 'text-muted-foreground' };
}

/** Lift a generate report's auto-resolved ledger into rows (title + detail + badge),
 *  for the Scenarios-tab collapsed "auto-resolved" group. Empty when nothing self-healed. */
export function buildAutoResolvedRows(
  report: GuardGenerateReport | null,
  scenarioRows: readonly GuardScenarioRowData[],
): GuardAutoResolvedRowData[] {
  if (!report?.autoResolved?.length) return [];
  const resolveHeading = makeHeadingResolver(scenarioRows);
  return report.autoResolved.map((entry, index) => ({
    id: `auto:${entry.anchor}:${index}`,
    title: entry.title,
    doc: entry.doc,
    anchor: entry.anchor,
    headingText: resolveHeading(entry.doc, entry.anchor),
    kind: entry.kind,
    detail: entry.kind === 'fidelity-discard' ? entry.mismatch : entry.brief,
    badge: autoResolvedBadge(entry),
    ...(entry.kind === 'fidelity-discard' ? { mismatch: entry.mismatch, outcome: entry.outcome } : {}),
  }));
}

/** The unified inventory: committed scenarios first, then birth findings — so a
 *  section that has both shows its scenarios above its findings, and a findings-only
 *  section still gets its own group header. The panel re-splits them into blocks; the
 *  flat order only decides first-seen doc/section grouping. */
export function buildListRows(
  scenarioRows: readonly GuardScenarioRowData[],
  findingRows: readonly GuardFindingRowData[],
): GuardListRow[] {
  return [
    ...scenarioRows.map((r) => ({ kind: 'scenario' as const, ...r })),
    ...findingRows.map((r) => ({ kind: 'finding' as const, ...r })),
  ];
}

/** A row's list status — the finding pseudo-status, else the scenario's. */
export function guardListRowStatus(row: GuardListRow): GuardListStatus {
  if (row.kind === 'finding') return FINDING_STATUS;
  return guardRowStatus(row);
}

/** The dropdown/label text for a list status — "Finding" for the pseudo-status. */
export function guardListStatusLabel(status: GuardListStatus): string {
  if (status === FINDING_STATUS) return 'Finding';
  return guardStatusMeta(status).label;
}
