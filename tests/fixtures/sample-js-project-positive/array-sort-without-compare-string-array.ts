// Sorting a string array without a comparator is lexicographic by design.
// The rule's concern is numeric arrays sorted as strings; pure string arrays
// (Object.keys results, Set/Map keys, mapped slug/name lists) are safe.

interface Catalog {
  controlTypes: Record<string, boolean>;
}

export function sortedFlagKeys(data: Catalog): string[] {
  return Object.keys(data.controlTypes).sort();
}

export function sortedTimezones(): string[] {
  return Intl.supportedValuesOf('timeZone').sort();
}

export function sortFeatureNames(features: Set<string>): string[] {
  return Array.from(features).sort();
}

export function pluckSlugsAndSort(rows: ReadonlyArray<{ slug: string }>): string[] {
  return rows.map((r) => r.slug).sort();
}

interface GroupTotals {
  entries(): IterableIterator<[string, number]>;
}

export function topGroupKeys(groupTotals: GroupTotals, max: number): string[] {
  return Array.from(groupTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([key]) => key)
    .sort();
}

export function joinedFingerprint(parts: ReadonlyArray<string>): string {
  return [...parts].sort().join(',');
}
