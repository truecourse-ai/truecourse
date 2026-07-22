/**
 * The Scenarios-tab LEFT-PANEL row model — committed scenarios AND the quiet
 * tool-defect residue (`report.birthFindings`) as one inventory. A birth finding is
 * no longer real drift (that commits as an ordinary failing scenario); it is a
 * weak/undecidable candidate the tool couldn't turn into a guard, so it rides the
 * SAME doc › section grouping as scenarios but reads as a muted tool defect, never
 * red drift. Findings have no persisted id, so each gets a deterministic key
 * (`finding:<anchor>:<index-in-report>`) that both the `?gscn` param and the tab
 * identity use — stable across reloads while the same generate report is on disk.
 * Pure/client-only: the report payload already carries everything.
 */

import {
  dismissedClaimKey,
  type GuardBirthFinding,
  type GuardFamilyEscalation,
  type GuardGenerateReport,
  type GuardSectionCoverageStatus,
} from '@truecourse/shared';
import { sectionLeaf } from '@/lib/guard-drifts';
import { guardStatusMeta } from '@/lib/guard-status';
import { guardRowStatus, type GuardScenarioRowData } from '@/hooks/useGuardScenarios';

/** The synthetic list status of the tool-defect residue — a muted chip, never a run outcome. */
export const FINDING_STATUS = 'finding' as const;

/** A row's list status: a real section-coverage status, or the tool-defect pseudo-status. */
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

/** A family escalation (item 4) lifted into a muted, informational row — a
 *  TOOL-LIMITATION notice, NOT a finding: a recurring defect family a family-level
 *  self-heal could not converge. ONE row: a member `count` + a plain-language
 *  `description` + Dismiss + a prefilled Report-issue link. The member identities ride
 *  the underlying `escalation` ONLY so a Dismiss can fan out to each; they are never
 *  rendered. Renders in its own collapsed group, never in the filterable inventory. */
export interface GuardFamilyRowData {
  /** The escalation's stable id — the tab/URL key. */
  id: string;
  /** The recurring-defect description shown on the row. */
  description: string;
  /** How many member claims the family holds. */
  count: number;
  /** Already fully dismissed — every member claim is in `decisions.json` (the report is
   *  a snapshot, so the row stays until the next generate; the panel strikes it through). */
  dismissed: boolean;
  /** The raw escalation — carries the member identities a Dismiss fans out to, plus the
   *  fields the Report-issue URL prefills. */
  escalation: GuardFamilyEscalation;
}

/** Lift a generate report's family escalations into rows for the Scenarios-tab collapsed
 *  "tool limitations" group. A family is `dismissed` once EVERY member claim is dismissed
 *  in `decisions.json`. Empty when nothing escalated. */
export function buildFamilyEscalationRows(
  report: GuardGenerateReport | null,
  dismissedKeys: ReadonlySet<string> = new Set(),
): GuardFamilyRowData[] {
  if (!report?.familyEscalations?.length) return [];
  return report.familyEscalations.map((escalation) => ({
    id: escalation.id,
    description: escalation.description,
    count: escalation.count,
    dismissed: escalation.members.every((m) => dismissedKeys.has(dismissedClaimKey(m.doc, m.anchor, m.title))),
    escalation,
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

/** A row's list status — the tool-defect pseudo-status, else the scenario's. */
export function guardListRowStatus(row: GuardListRow): GuardListStatus {
  if (row.kind === 'finding') return FINDING_STATUS;
  return guardRowStatus(row);
}

/** The dropdown/label text for a list status — "Tool defect" for the pseudo-status. */
export function guardListStatusLabel(status: GuardListStatus): string {
  if (status === FINDING_STATUS) return 'Tool defect';
  return guardStatusMeta(status).label;
}
