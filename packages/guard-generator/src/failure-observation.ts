import { GuardFailureObservationSchema, type GuardFailureObservation } from '@truecourse/shared'

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(',')}}`
  return JSON.stringify(value)
}

/** Undefined means exact supported evidence equivalence; prose is never compared. */
export function compareFailureObservations(
  predicted: GuardFailureObservation,
  actual: GuardFailureObservation,
): string | undefined {
  const left = GuardFailureObservationSchema.safeParse(predicted)
  const right = GuardFailureObservationSchema.safeParse(actual)
  if (!left.success || !right.success) return 'invalid or unsupported observation version'
  if (left.data.kind === 'web-target' && left.data.visibility === 'unknown') return 'target visibility was not observed'
  if (right.data.kind === 'web-target' && right.data.visibility === 'unknown') return 'target visibility was not observed'
  for (const key of new Set([...Object.keys(left.data), ...Object.keys(right.data)])) {
    if (stable((left.data as Record<string, unknown>)[key]) !== stable((right.data as Record<string, unknown>)[key])) return `observation ${key} differs`
  }
  return undefined
}
