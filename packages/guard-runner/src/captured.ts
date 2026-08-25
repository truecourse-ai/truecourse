/**
 * The `${captured:<name>}` token, run side — what a later step reads out of what
 * an earlier step produced.
 *
 * Same surgical-replacement rule as `${unique}` and `${sandbox}`: a literal
 * substring swap, never a parser, applied to scenario-AUTHORED strings only (the
 * recipe-owned entrypoint is never interpolated). It runs LAST of the token
 * passes, so a captured value — the one piece of text that came from the program
 * rather than from the scenario — is inserted and never re-scanned: a program that
 * happens to print `${sandbox}` cannot make the next step's argv resolve it.
 *
 * An unknown name THROWS rather than passing the literal token through. The
 * loader's cross-check (`captureDefects`) has already rejected every scenario that
 * could reach here, so the only remaining way in is a freshly authored scenario in
 * birth validation — where a thrown, named reference is a defect the author can
 * fix, and a `${captured:…}` handed to a child process is a green test that proved
 * nothing.
 */

import { capturedTokenRefs } from '@truecourse/shared'

/** A `${captured:…}` reference with no value behind it at the moment it was read. */
export class CapturedValueError extends Error {
  constructor(readonly variable: string) {
    super(`\${captured:${variable}} is not defined — no earlier step captured it`)
    this.name = 'CapturedValueError'
  }
}

/** {@link applyCaptured} across a step's env overlay — its VALUES, as `${unique}` does. */
export function applyCapturedEnv(
  env: Record<string, string>,
  values: ReadonlyMap<string, string>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(env).map(([k, v]) => [k, applyCaptured(v, values)]))
}

/** Replace every `${captured:<name>}` with the value that step captured. */
export function applyCaptured(text: string, values: ReadonlyMap<string, string>): string {
  if (!text.includes('${captured:')) return text
  let out = text
  for (const name of capturedTokenRefs(text)) {
    const value = values.get(name)
    if (value === undefined) throw new CapturedValueError(name)
    out = out.split(`\${captured:${name}}`).join(value)
  }
  return out
}
