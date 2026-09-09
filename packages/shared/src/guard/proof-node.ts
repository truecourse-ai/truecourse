// Server-only hashing lives behind @truecourse/shared/guard-proof-node.
// Do not re-export from the shared root: the dashboard imports its schemas.
import { createHash } from 'node:crypto'

/** Bind a review to the parsed scenario, insensitive to object key ordering. */
export function scenarioReviewFingerprint(scenario: unknown): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value !== null && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]))
      : value
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical(scenario))).digest('hex')}`
}
