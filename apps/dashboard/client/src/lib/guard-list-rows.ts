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

import type { GuardBirthFinding, GuardGenerateReport, GuardSectionCoverageStatus } from '@truecourse/shared';
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
}

/** A single inventory row — a committed scenario or a birth finding. Both carry
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
  }));
}

/** The unified inventory: committed scenarios first, then birth findings — so a
 *  section that has both shows its scenarios above its findings, and a
 *  findings-only section still gets its own group header. */
export function buildListRows(
  scenarioRows: readonly GuardScenarioRowData[],
  findingRows: readonly GuardFindingRowData[],
): GuardListRow[] {
  return [
    ...scenarioRows.map((r) => ({ kind: 'scenario' as const, ...r })),
    ...findingRows.map((r) => ({ kind: 'finding' as const, ...r })),
  ];
}

/** A row's list status — the finding pseudo-status for findings, else the scenario's. */
export function guardListRowStatus(row: GuardListRow): GuardListStatus {
  return row.kind === 'finding' ? FINDING_STATUS : guardRowStatus(row);
}

/** The dropdown/label text for a list status — "Finding" for the pseudo-status. */
export function guardListStatusLabel(status: GuardListStatus): string {
  return status === FINDING_STATUS ? 'Finding' : guardStatusMeta(status).label;
}
