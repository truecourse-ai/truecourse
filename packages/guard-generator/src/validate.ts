/**
 * Shared helpers for the guard-generator's validate-then-correct discipline. The
 * runners return the model's raw parsed JSON (unknown); each stage Zod-validates
 * it, and on a schema failure re-asks ONCE with the invalid output quoted back
 * (see the per-stage prompts). These render the two pieces that re-ask needs: a
 * safe-to-embed quote of the offending output and a one-line reason.
 */

import type { ZodError } from 'zod'

/** Max chars of an invalid model output quoted back in a corrective re-ask. */
const QUOTE_CAP = 600

/** A safe-to-embed rendering of an invalid model output for a corrective re-ask. */
export function quoteInvalidOutput(raw: unknown): string {
  let text: string
  try {
    text = typeof raw === 'string' ? raw : (JSON.stringify(raw) ?? String(raw))
  } catch {
    text = String(raw)
  }
  return text.length > QUOTE_CAP ? `${text.slice(0, QUOTE_CAP)}…(truncated)` : text
}

/** Flatten a ZodError to a single-line `path: message; …` summary. */
export function flattenZodError(error: ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}
