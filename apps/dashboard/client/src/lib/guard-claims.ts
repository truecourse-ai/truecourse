/**
 * The Claims tab's pure half: how a claim corpus is READ.
 *
 * Three things live here so the panel, the pane and the detail can never
 * disagree about them:
 *
 *   - the ROW IDENTITY of a refused statement. A claim owns its store id; an
 *     untestable row has none, so it gets a synthetic one built from where it sits
 *     — the whole point being that it is addressable exactly like a claim, in the
 *     same `?gclaim=` tab set.
 *   - the GROUPING: doc, then the section within it, in the order the corpus
 *     lists them, with the doc's refused statements as its final group.
 *   - the COVERAGE paint, one entry per coverage state, in the same opacity idiom
 *     as the section-status table so a claim chip reads beside a status chip.
 */

import type {
  GuardClaimCoverage,
  GuardClaimRow,
  GuardClaimsView,
  GuardSectionClaimGap,
  GuardUntestableRow,
} from '@truecourse/shared';

/** The synthetic row id of a refused statement — its address in the tab set. */
export function untestableRowId(row: GuardUntestableRow, index: number): string {
  return `untestable:${row.doc}#${row.anchor}#${index}`;
}

/** A refused statement paired with the id the tab set addresses it by. */
export interface GuardUntestableEntry {
  id: string;
  row: GuardUntestableRow;
}

/** One section of one doc — the claims it states, under its live heading. */
export interface GuardClaimSectionGroup {
  anchor: string;
  /** The live heading text; absent when the anchor no longer resolves. */
  headingText?: string;
  claims: GuardClaimRow[];
}

/** One doc — its sections, then the statements extraction refused in it. */
export interface GuardClaimDocGroup {
  doc: string;
  sections: GuardClaimSectionGroup[];
  untestable: GuardUntestableEntry[];
}

/** Every refused statement with its stable id — index over the WHOLE list, so a
 *  search that hides rows never renumbers the ones that stay. */
export function guardUntestableEntries(view: GuardClaimsView | null): GuardUntestableEntry[] {
  return (view?.untestable ?? []).map((row, i) => ({ id: untestableRowId(row, i), row }));
}

function matchesClaim(claim: GuardClaimRow, q: string): boolean {
  return `${claim.id} ${claim.title} ${claim.claim}`.toLowerCase().includes(q);
}

function matchesUntestable(row: GuardUntestableRow, q: string): boolean {
  return `${row.anchor} ${row.text} ${row.reason}`.toLowerCase().includes(q);
}

/**
 * The list as the panel paints it: docs in corpus order, each doc's sections in
 * corpus order, the doc's refused statements last. A doc that keeps nothing after
 * the search drops out entirely.
 */
export function groupGuardClaims(
  claims: readonly GuardClaimRow[],
  untestable: readonly GuardUntestableEntry[],
  search = '',
): GuardClaimDocGroup[] {
  const q = search.trim().toLowerCase();
  const docs = new Map<string, GuardClaimDocGroup>();
  const doc = (name: string): GuardClaimDocGroup => {
    let group = docs.get(name);
    if (!group) {
      group = { doc: name, sections: [], untestable: [] };
      docs.set(name, group);
    }
    return group;
  };

  for (const claim of claims) {
    if (q && !matchesClaim(claim, q)) continue;
    const group = doc(claim.doc);
    let section = group.sections.find((s) => s.anchor === claim.anchor);
    if (!section) {
      section = { anchor: claim.anchor, ...(claim.headingText ? { headingText: claim.headingText } : {}), claims: [] };
      group.sections.push(section);
    }
    section.claims.push(claim);
  }

  for (const entry of untestable) {
    if (q && !matchesUntestable(entry.row, q)) continue;
    doc(entry.row.doc).untestable.push(entry);
  }

  return [...docs.values()];
}

/** What a `?gclaim=` selection resolves to — a claim, a refused statement, or nothing. */
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

/** How a coverage state is painted and what it means. */
export interface GuardClaimCoverageMeta {
  label: string;
  /** Swatch colour for the list row's dot. */
  dot: string;
  /** Pill classes for the detail's chip. */
  chip: string;
  hint: string;
}

export const GUARD_CLAIM_COVERAGE: Record<GuardClaimCoverage, GuardClaimCoverageMeta> = {
  proven: {
    label: 'Proven',
    dot: 'bg-emerald-500',
    chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    hint: 'A scenario step names this claim — something actually observes it.',
  },
  planned: {
    label: 'Planned',
    dot: 'bg-sky-500',
    chip: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
    hint: 'A flow carries this claim, but no scenario step names it yet.',
  },
  gapped: {
    label: 'Gapped',
    dot: 'bg-amber-500',
    chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    hint: 'No flow carries this claim, and the last generate recorded why.',
  },
  unplanned: {
    label: 'Unplanned',
    dot: 'bg-muted-foreground/40',
    chip: 'bg-muted text-muted-foreground',
    hint: 'No flow carries this claim and nothing accounts for it — the hole synthesis owes an answer for.',
  },
};

/** The muted `needs` hint a list row wears — what testing this claim would take. */
export function guardClaimNeedsHint(claim: GuardClaimRow): string {
  return claim.needs.length === 0 ? 'needs nothing' : `needs ${claim.needs.join(', ')}`;
}

/** Worst-first: the holes lead, the proven statements close the list. */
export const GUARD_CLAIM_COVERAGE_ORDER: GuardClaimCoverage[] = ['unplanned', 'gapped', 'planned', 'proven'];

/**
 * What one doc SECTION states, as the rows its detail lists. Three sources, one
 * list, because a reader looking at a section asks one question ("what does this
 * promise, and what stands behind it"):
 *
 *   - the section's CLAIMS from the claim store, worst coverage first;
 *   - the generate GAPS the section coverage carries that no stored claim
 *     answers for — a gap that named no claim id, or any gap at all when the
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
