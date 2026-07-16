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
  guardFindingKey,
  type GuardBirthFinding,
  type GuardGenerateError,
  type GuardGenerateReport,
  type GuardHeldSection,
  type GuardReadyScenario,
  type GuardSectionCoverageStatus,
} from '@truecourse/shared';
import { sectionLeaf } from '@/lib/guard-drifts';
import { guardStatusMeta } from '@/lib/guard-status';
import { guardRowStatus, type GuardScenarioRowData } from '@/hooks/useGuardScenarios';

/** The synthetic list status of a birth finding — a distinct chip, never a run outcome. */
export const FINDING_STATUS = 'finding' as const;
/** The synthetic list status of a ready-but-held scenario — its own "limbo" chip. */
export const HELD_STATUS = 'held' as const;

/** A row's list status: a real section-coverage status, or a pseudo-status. */
export type GuardListStatus =
  | GuardSectionCoverageStatus
  | typeof FINDING_STATUS
  | typeof HELD_STATUS;

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
   * The finding's blast radius: how many ready-but-held scenarios its section holds
   * back (resolving the finding releases them). 0 when the section held nothing.
   */
  heldCount: number;
  /**
   * The user has already dismissed this finding in `decisions.json` — the report
   * is a snapshot, so the row stays until the next generate. The panel strikes it
   * through and the detail offers Un-dismiss. Set when EITHER the row's received
   * `findingKey` matches a `dismissedFindings` entry (exactly this row) or a
   * LEGACY claim entry matches its `(doc, anchor, claim)` — legacy entries
   * represent a whole-claim judgment, so they strike every sibling row.
   */
  dismissed: boolean;
  /** Which identity dismissed it — decides the Un-dismiss route (two identities,
   *  two operations). `'finding'` wins when both match. Absent when not dismissed. */
  dismissedVia?: 'finding' | 'claim';
}

/** A blocking finding on a held section — carries its finding-row key for click-through. */
export interface GuardHeldBlockerFinding {
  finding: GuardBirthFinding;
  /** The finding row's tab key — opening it jumps to that finding's detail tab. */
  findingId: string;
}

/** What holds a section's ready scenarios back — its birth findings and authoring errors. */
export interface GuardHeldBlockers {
  findings: GuardHeldBlockerFinding[];
  errors: GuardGenerateError[];
}

/** A ready-but-held scenario lifted into a first-class inventory row. */
export interface GuardHeldRowData {
  /** Deterministic tab/URL key — `held:<anchor>:<flat-index>`. */
  id: string;
  /** The claim the birth-passed candidate asserts. */
  title: string;
  doc: string;
  anchor: string;
  /** The bound section's human heading — report-joined, else a co-bound scenario's. */
  headingText?: string;
  /** Flat position across all held scenarios — stable while the report is on disk. */
  index: number;
  ready: GuardReadyScenario;
  /** What holds this section — its findings (click-through) + errors (messages). */
  blockers: GuardHeldBlockers;
}

/** A single inventory row — a committed scenario, a birth finding, or a held scenario.
 *  All carry `id`/`title`/`doc`/`anchor`/`headingText`, so the panel groups and labels
 *  them uniformly and only branches on `kind` for the badge + selection payload. */
export type GuardListRow =
  | ({ kind: 'scenario' } & GuardScenarioRowData)
  | ({ kind: 'finding' } & GuardFindingRowData)
  | ({ kind: 'held' } & GuardHeldRowData);

/** The deterministic ROW key (tab/URL identity) for a finding at a given report
 *  index. Renamed from `findingKey`: that name now belongs to the durable
 *  per-finding dismissal identity the server stamps (`GuardBirthFinding.findingKey`). */
export function findingRowKey(finding: GuardBirthFinding, index: number): string {
  return `finding:${finding.anchor}:${index}`;
}

/** The deterministic key for a held scenario at a given flat index. */
export function heldKey(section: GuardHeldSection, index: number): string {
  return `held:${section.anchor}:${index}`;
}

/** `doc\0anchor` → count of ready-but-held scenarios there — a finding's blast radius. */
function heldCountByKey(report: GuardGenerateReport | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const h of report?.heldSections ?? []) {
    m.set(`${h.doc}\0${h.anchor}`, (m.get(`${h.doc}\0${h.anchor}`) ?? 0) + h.readyScenarios.length);
  }
  return m;
}

/** `doc\0anchor` → the section's blockers (its findings, keyed for click-through, and errors). */
function blockersByKey(report: GuardGenerateReport): Map<string, GuardHeldBlockers> {
  const m = new Map<string, GuardHeldBlockers>();
  const at = (doc: string, anchor: string): GuardHeldBlockers => {
    const k = `${doc}\0${anchor}`;
    const b = m.get(k) ?? { findings: [], errors: [] };
    m.set(k, b);
    return b;
  };
  report.birthFindings.forEach((finding, index) => {
    at(finding.doc, finding.anchor).findings.push({ finding, findingId: findingRowKey(finding, index) });
  });
  for (const error of report.errors) at(error.doc, error.anchor).errors.push(error);
  return m;
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
  dismissedFindingKeys: ReadonlySet<string> = new Set(),
): GuardFindingRowData[] {
  if (!report) return [];
  const m = headingMap(scenarioRows);
  const held = heldCountByKey(report);
  return report.birthFindings.map((finding, index) => {
    // Two dismissal identities, two striking rules (§1c): a NEW finding entry
    // strikes exactly the rows whose RECEIVED findingKey matches (the client
    // never re-derives identity); a LEGACY claim entry represents a whole-claim
    // judgment and still strikes every sibling row of the claim.
    const viaFinding =
      finding.findingKey !== undefined && dismissedFindingKeys.has(finding.findingKey);
    const viaClaim =
      finding.claim !== undefined &&
      dismissedKeys.has(dismissedClaimKey(finding.doc, finding.anchor, finding.claim));
    const dismissedVia = viaFinding ? ('finding' as const) : viaClaim ? ('claim' as const) : undefined;
    return {
      id: findingRowKey(finding, index),
      title: finding.title,
      doc: finding.doc,
      anchor: finding.anchor,
      headingText: finding.headingText ?? m.get(`${finding.doc}\0${finding.anchor}`),
      index,
      finding,
      heldCount: held.get(`${finding.doc}\0${finding.anchor}`) ?? 0,
      dismissed: dismissedVia !== undefined,
      ...(dismissedVia !== undefined ? { dismissedVia } : {}),
    };
  });
}

/** The dismissed-claim identity keys from a decisions file — `buildFindingRows`
 *  membership set. Kept here so the client keys exactly as the engine does. */
export function dismissedKeySet(
  dismissedClaims: readonly { doc: string; anchor: string; title: string }[] | undefined,
): Set<string> {
  return new Set((dismissedClaims ?? []).map((d) => dismissedClaimKey(d.doc, d.anchor, d.title)));
}

/** The per-finding dismissal identity keys from a decisions file — the
 *  `dismissedKeySet` sibling for `dismissedFindings`, joined with the same shared
 *  `guardFindingKey` the server stamps rows with. */
export function dismissedFindingKeySet(
  dismissedFindings: readonly { doc: string; anchor: string; scenarioHash: string }[] | undefined,
): Set<string> {
  return new Set(
    (dismissedFindings ?? []).map((f) => guardFindingKey(f.doc, f.anchor, f.scenarioHash)),
  );
}

/** Lift a generate report's held sections into per-scenario inventory rows. Each
 *  ready scenario is a row; the heading prefers the report's server-joined
 *  `headingText`, then a co-bound scenario's, else the slug. The row carries its
 *  section's blockers so the detail can render WHAT HOLDS IT. */
export function buildHeldRows(
  report: GuardGenerateReport | null,
  scenarioRows: readonly GuardScenarioRowData[],
): GuardHeldRowData[] {
  if (!report?.heldSections?.length) return [];
  const m = headingMap(scenarioRows);
  const blockers = blockersByKey(report);
  const rows: GuardHeldRowData[] = [];
  let index = 0;
  for (const section of report.heldSections) {
    const headingText = section.headingText ?? m.get(`${section.doc}\0${section.anchor}`);
    const b = blockers.get(`${section.doc}\0${section.anchor}`) ?? { findings: [], errors: [] };
    for (const ready of section.readyScenarios) {
      rows.push({
        id: heldKey(section, index),
        title: ready.title,
        doc: section.doc,
        anchor: section.anchor,
        headingText,
        index,
        ready,
        blockers: b,
      });
      index++;
    }
  }
  return rows;
}

/** The unified inventory: committed scenarios first, then birth findings, then
 *  ready-but-held scenarios — so a section that has several shows its scenarios
 *  above its findings/held, and a findings- or held-only section still gets its own
 *  group header. The panel re-splits them into blocks; the flat order only decides
 *  first-seen doc/section grouping. */
export function buildListRows(
  scenarioRows: readonly GuardScenarioRowData[],
  findingRows: readonly GuardFindingRowData[],
  heldRows: readonly GuardHeldRowData[] = [],
): GuardListRow[] {
  return [
    ...scenarioRows.map((r) => ({ kind: 'scenario' as const, ...r })),
    ...findingRows.map((r) => ({ kind: 'finding' as const, ...r })),
    ...heldRows.map((r) => ({ kind: 'held' as const, ...r })),
  ];
}

/** A row's list status — the finding/held pseudo-status, else the scenario's. */
export function guardListRowStatus(row: GuardListRow): GuardListStatus {
  if (row.kind === 'finding') return FINDING_STATUS;
  if (row.kind === 'held') return HELD_STATUS;
  return guardRowStatus(row);
}

/** The dropdown/label text for a list status — "Finding"/"Held" for the pseudo-statuses. */
export function guardListStatusLabel(status: GuardListStatus): string {
  if (status === FINDING_STATUS) return 'Finding';
  if (status === HELD_STATUS) return 'Held';
  return guardStatusMeta(status).label;
}
