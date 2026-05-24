// A parameter name that happens to match a selector word (`allow`, `include`,
// `skip`, etc.) is only a behavior switch when the value itself is a boolean
// flag. Holding a string or list of allowed values is data — splitting the
// function in two would force callers to dispatch on the data they hold.

export function getAllowedHeaders(
  origin: string,
  allowed?: string | string[],
): string[] {
  if (!allowed) return [origin]
  return Array.isArray(allowed) ? allowed : [allowed]
}

export function joinIncluded(included: readonly string[]): string {
  if (included.length === 0) return 'none'
  return included.join(', ')
}
