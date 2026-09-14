/**
 * THE counts beside a filter's values, for every list that narrows along
 * several dimensions ({@link FilterBuilder}).
 *
 * A value carries TWO numbers, because a menu and an applied pill ask
 * different questions. `count` is FACETED — how many rows picking this would
 * leave, computed over the rows the search and the OTHER dimensions already
 * keep, never over the dimension's own selection. Picking a repository moves
 * the status counts; picking a status never makes its own count shrink to
 * itself, and the values beside it still say what swapping to them would give.
 * `total` is the value's own size in the full set — how many rows that filter
 * alone keeps — which is what the pill of an applied filter says, so it does
 * not collapse to the intersection every other number on the page already
 * shows.
 *
 * Reading: AND across dimensions, OR within one, the reading the builder
 * documents and every list applies to its rows.
 */

import { filterKey, selectedValues, type FilterDimension, type FilterValue } from './filter-builder';

/** One value a dimension offers: what it is called, and what it rides as. */
export interface FacetValue {
  /** The value as it rides the address and the selection key. */
  value: string;
  /** Its word in the menu. */
  label: string;
}

export interface FacetDimension<T> {
  key: string;
  /** The dimension's word: "Area", "Status". */
  label: string;
  /** The values a row carries here; a row may carry several (OR within one). */
  valuesOf: (row: T) => readonly string[];
  /** The values offered, in the order the menu lists them. */
  values: readonly FacetValue[];
  /** Drop a value no row of the FULL set carries, which is each list's own rule. */
  hideEmpty?: boolean;
}

/** How many of `rows` carry each value along one dimension. */
function countBy<T>(rows: readonly T[], valuesOf: (row: T) => readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const value of new Set(valuesOf(row))) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

export function facetDimensions<T>({
  rows,
  dimensions,
  selected,
  matches,
}: {
  /** Every row the list holds, before the search and before any filter. */
  rows: readonly T[];
  dimensions: readonly FacetDimension<T>[];
  /** The selection, as the builder's `dimension:value` keys. */
  selected: readonly string[];
  /** The search: a row it excludes is counted nowhere. */
  matches?: (row: T) => boolean;
}): FilterDimension[] {
  const searched = matches ? rows.filter(matches) : rows;
  return dimensions.map((dimension) => {
    const others = dimensions.filter((d) => d.key !== dimension.key);
    const narrowed = searched.filter((row) =>
      others.every((other) => {
        const wanted = selectedValues(selected, other.key);
        return wanted.length === 0 || other.valuesOf(row).some((value) => wanted.includes(value));
      }),
    );
    const counts = countBy(narrowed, dimension.valuesOf);
    const full = countBy(rows, dimension.valuesOf);
    const options: FilterValue[] = [];
    for (const { value, label } of dimension.values) {
      const total = full.get(value) ?? 0;
      if (dimension.hideEmpty && total === 0) continue;
      options.push({
        key: filterKey(dimension.key, value),
        label,
        count: counts.get(value) ?? 0,
        total,
      });
    }
    return { key: dimension.key, label: dimension.label, options };
  });
}
