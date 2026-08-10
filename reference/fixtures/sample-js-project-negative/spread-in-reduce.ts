// Spreading the accumulator on every iteration copies the whole accumulator
// each pass — the O(n^2) anti-pattern this rule catches.

interface Entry {
  key: string
  value: number
}

export function combine(entries: readonly Entry[]): Record<string, number> {
  // VIOLATION: performance/deterministic/spread-in-reduce
  return entries.reduce(
    (acc, entry) => ({ ...acc, [entry.key]: entry.value }),
    {} as Record<string, number>,
  )
}
