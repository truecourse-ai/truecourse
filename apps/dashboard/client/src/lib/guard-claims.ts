/**
 * The claim corpus's pure half: how a claims view is READ.
 *
 *   - the ROW IDENTITY of an untestable statement. A claim owns its id; an
 *     untestable row has none, so it gets a synthetic one built from where it
 *     sits, the whole point being that it is addressable exactly like a claim,
 *     in the same `?claim=` tab set.
 *   - the ORDER claims are listed in (worst status first, then by document),
 *     and the five-word filter over them.
 */

import { GUARD_COVERAGE_STATUS_PRECEDENCE, guardCoveragePlainStatus } from '@truecourse/shared';
import type {
  GuardClaimRow,
  GuardClaimsView,
  GuardCoveragePlainStatus,
  GuardUntestableRow,
} from '@truecourse/shared';

/** The synthetic row id of an untestable statement, its address in the tab set. */
export function untestableRowId(row: GuardUntestableRow, index: number): string {
  return `untestable:${row.doc}#${index}`;
}

/** An untestable statement paired with the id the tab set addresses it by. */
export interface GuardUntestableEntry {
  id: string;
  row: GuardUntestableRow;
}

/** Every untestable statement with its stable id, index over the WHOLE list, so a
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

/** Worst first by the one precedence, then by document, then by statement. */
export function sortGuardClaims(claims: readonly GuardClaimRow[]): GuardClaimRow[] {
  const rank = (c: GuardClaimRow): number => {
    const i = GUARD_COVERAGE_STATUS_PRECEDENCE.indexOf(c.status);
    return i === -1 ? GUARD_COVERAGE_STATUS_PRECEDENCE.length : i;
  };
  return [...claims].sort(
    (a, b) => rank(a) - rank(b) || a.doc.localeCompare(b.doc) || a.statement.localeCompare(b.statement),
  );
}

/** The claims wearing one of the five words, or all of them for a null filter. */
export function filterGuardClaims(
  claims: readonly GuardClaimRow[],
  word: GuardCoveragePlainStatus | null,
): GuardClaimRow[] {
  return word === null ? [...claims] : claims.filter((c) => guardCoveragePlainStatus(c.status) === word);
}
