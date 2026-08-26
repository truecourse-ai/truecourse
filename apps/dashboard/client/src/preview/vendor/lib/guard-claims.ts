/**
 * The Claims tab's pure half: how a claim corpus is READ.
 *
 * Two things live here so the section panel and the claim detail can never
 * disagree about them:
 *
 *   - the ROW IDENTITY of a refused statement. A claim owns its store id; an
 *     untestable row has none, so it gets a synthetic one built from where it sits
 *    , the whole point being that it is addressable exactly like a claim, in the
 *     same `?claim=` tab set.
 *   - the ORDER a section's claims are read in (worst coverage first). Coverage
 *     never becomes a paint: a claim row is the doc's sentence, not a verdict.
 *
 * There is no doc-level GROUPING any more: a claim is read inside the section that
 * states it, and the corpus-at-a-glance card that needed a per-doc rollup was the
 * second inventory that rule exists to prevent.
 */

import type {
  GuardClaimCoverage,
  GuardClaimRow,
  GuardClaimsView,
  GuardSectionClaimGap,
  GuardUntestableRow,
} from '@/preview/vendor/shared';

/** The synthetic row id of a refused statement, its address in the tab set. */
export function untestableRowId(row: GuardUntestableRow, index: number): string {
  return `untestable:${row.doc}#${row.anchor}#${index}`;
}

/** A refused statement paired with the id the tab set addresses it by. */
export interface GuardUntestableEntry {
  id: string;
  row: GuardUntestableRow;
}

/** Every refused statement with its stable id, index over the WHOLE list, so a
 *  search that hides rows never renumbers the ones that stay. */
export function guardUntestableEntries(view: GuardClaimsView | null): GuardUntestableEntry[] {
  return (view?.untestable ?? []).map((row, i) => ({ id: untestableRowId(row, i), row }));
}

export type GuardClaimSelection =
  | { kind: 'claim'; claim: GuardClaimRow }
  | { kind: 'untestable'; row: GuardUntestableRow };

export function findGuardClaimSelection(
  view: GuardClaimsView | null,
  untestable: readonly GuardUntestableEntry[],
  id: string | null,
): GuardClaimSelection | null {
  if (!view || !id) return null;
  const claim = view.claims.find((c) => c.id === id);
  if (claim) return { kind: 'claim', claim };
  const entry = untestable.find((u) => u.id === id);
  return entry ? { kind: 'untestable', row: entry.row } : null;
}

/**
 * Worst-first: the holes lead, the proven statements close the list. Coverage is
 * the list's ORDER and nothing else, a claim row states no status, so this never
 * becomes a paint.
 */
export const GUARD_CLAIM_COVERAGE_ORDER: GuardClaimCoverage[] = ['failing', 'unplanned', 'gapped', 'planned', 'proven'];

/**
 * What one doc SECTION states, as the rows its detail lists. Three sources, one
 * list, because a reader looking at a section asks one question ("what does this
 * promise, and what stands behind it"):
 *
 *   - the section's CLAIMS from the claim store, worst coverage first;
 *   - the generate GAPS the section coverage carries that no stored claim
 *     answers for, a gap that named no claim id, or any gap at all when the
 *     store has not been extracted yet, so a reason is never lost;
 *   - the statements extraction REFUSED in this section, last and quieter.
 */
export type GuardSectionClaimItem =
  | { kind: 'claim'; id: string; claim: GuardClaimRow }
  | { kind: 'gap'; id: string; gap: GuardSectionClaimGap }
  | { kind: 'untestable'; id: string; row: GuardUntestableRow };

export function sectionClaimItems(
  section: { anchor: string; claimGaps?: readonly GuardSectionClaimGap[] },
  doc: string | null,
  claims: readonly GuardClaimRow[],
  untestable: readonly GuardUntestableEntry[],
): GuardSectionClaimItem[] {
  const mine = claims.filter((c) => c.anchor === section.anchor && (doc == null || c.doc === doc));
  const known = new Set(mine.map((c) => c.id));
  const rank = (c: GuardClaimRow): number => GUARD_CLAIM_COVERAGE_ORDER.indexOf(c.coverage);
  const items: GuardSectionClaimItem[] = [...mine]
    .sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title))
    .map((claim) => ({ kind: 'claim', id: claim.id, claim }));
  (section.claimGaps ?? []).forEach((gap, i) => {
    if (gap.claimId && known.has(gap.claimId)) return;
    items.push({ kind: 'gap', id: gap.claimId ?? `gap:${section.anchor}#${i}`, gap });
  });
  for (const entry of untestable) {
    if (entry.row.anchor !== section.anchor) continue;
    if (doc != null && entry.row.doc !== doc) continue;
    items.push({ kind: 'untestable', id: entry.id, row: entry.row });
  }
  return items;
}
