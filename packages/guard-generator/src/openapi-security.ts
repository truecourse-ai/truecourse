/**
 * OpenAPI security-scheme → credential mapping for the api authoring prompt (plan
 * item 45 / B7).
 *
 * An OpenAPI operation declares which security schemes a request must satisfy
 * (`security`, resolved against `components.securitySchemes`); the recipe declares
 * which credentials the runner can inject (`api.credentials` + the seed's minted
 * ones). This module joins the two DETERMINISTICALLY so the author is told, per
 * operation, exactly which `{{cred:<name>}}` fulfills the required scheme — or that
 * NO declared credential does, so the claim is honestly `blockedOn` the named scheme
 * rather than authored to die un-authenticated at birth.
 *
 * Matching order (declared first, heuristic fallback):
 *  1. A credential's explicit `satisfies: <schemeName>` is AUTHORITATIVE — it binds
 *     regardless of headers and can satisfy a scheme the heuristics never match
 *     (oauth2/openIdConnect, an apiKey in a query/cookie).
 *  2. Otherwise a narrow header heuristic: an `apiKey`-in-`header` scheme is matched
 *     by a credential whose header equals the scheme's parameter name
 *     (case-insensitive); an `http`+`bearer` scheme by an `Authorization` credential.
 *     oauth2/openIdConnect and `http basic` are NEVER matched heuristically.
 * An ambiguous heuristic (several credentials match one scheme) advertises them ALL
 * and never blocks — a spurious block (a real credential the author can't use) is a
 * worse outcome than one extra option.
 *
 * AND / OR semantics: `security` is an OR of AND-groups. A group is satisfied only
 * when EVERY scheme in it is matched; the FIRST fully-satisfied group is advertised.
 * When no group is fully satisfiable the operation is blocked, naming the CLOSEST
 * group's still-unsatisfied schemes.
 */

import { createHash } from 'node:crypto'
import {
  parseSecuritySchemes,
  effectiveOperationSecurity,
  canonicalStringify,
  type OpenApiDoc,
  type SecurityScheme,
} from '@truecourse/shared/openapi'
import type { SectionInput } from './section-plan.js'

/** A recipe credential as an authoring capability the matcher joins against. */
export interface AuthCredential {
  /** The `{{cred:<name>}}` handle. */
  name: string
  /** The request header the runner injects it as. */
  header: string
  /** The security scheme it explicitly fulfills, when declared (authoritative). */
  satisfies?: string
}

/** One required scheme paired with the credential that fulfills it. */
export interface SatisfiedScheme {
  /** The OpenAPI security-scheme name. */
  scheme: string
  /** The credential name to reference as `{{cred:<name>}}`. */
  credential: string
  /** The request header to place the placeholder in. */
  header: string
}

/**
 * How an operation section's security requirement maps onto the declared credentials:
 * the schemes it requires, which credentials satisfy the chosen alternative, and (when
 * none can) the scheme names that block it. A PUBLIC operation yields all-empty arrays.
 */
export interface SectionAuth {
  /** Every distinct scheme named across the operation's OR-groups, sorted. */
  requiredSchemes: string[]
  /** The credentials fulfilling the first fully-satisfied OR-group ([] when blocked). */
  satisfiedBy: SatisfiedScheme[]
  /** The still-unsatisfied schemes of the closest group ([] when a group is satisfied). */
  unsatisfied: string[]
}

/** The parsed operation object carried by an OpenAPI section's canonical fullText. */
function sectionOperation(section: SectionInput): unknown | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(section.fullText)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const obj = parsed as Record<string, unknown>
  if (typeof obj.method !== 'string' || typeof obj.path !== 'string' || obj.operation === undefined) return null
  const op = obj.operation
  if (!op || typeof op !== 'object' || Array.isArray(op)) return null
  return op
}

/** The credentials that fulfill one scheme, declared-`satisfies` first then heuristic. */
function matchScheme(
  schemeName: string,
  scheme: SecurityScheme | undefined,
  credentials: AuthCredential[],
): SatisfiedScheme[] {
  const declared = credentials.filter((c) => c.satisfies === schemeName)
  if (declared.length > 0) {
    return declared.map((c) => ({ scheme: schemeName, credential: c.name, header: c.header }))
  }
  if (!scheme) return []
  let matches: AuthCredential[] = []
  if (scheme.type === 'apiKey' && scheme.in === 'header' && scheme.name) {
    const want = scheme.name.toLowerCase()
    matches = credentials.filter((c) => c.header.toLowerCase() === want)
  } else if (scheme.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer') {
    matches = credentials.filter((c) => c.header.toLowerCase() === 'authorization')
  }
  // oauth2 / openIdConnect / http basic / apiKey-in-query|cookie: only explicit `satisfies`.
  return matches.map((c) => ({ scheme: schemeName, credential: c.name, header: c.header }))
}

/**
 * Resolve the credentials that satisfy a section's OpenAPI security requirement, or
 * `null` when the section is not an operation. A public operation returns all-empty
 * arrays. See the module header for the matching order and AND/OR policy.
 */
export function resolveSectionAuth(
  section: SectionInput,
  doc: OpenApiDoc | null,
  credentials: AuthCredential[],
): SectionAuth | null {
  const operation = sectionOperation(section)
  if (operation === null) return null
  const groups = effectiveOperationSecurity(doc, operation)
  const requiredSchemes = [...new Set(groups.flat())].sort()
  if (groups.length === 0) return { requiredSchemes: [], satisfiedBy: [], unsatisfied: [] }

  const schemes = parseSecuritySchemes(doc)
  // Per group: the per-scheme match lists, and the schemes with no match at all.
  const evaluated = groups.map((group) => {
    const perScheme = group.map((name) => ({ name, matches: matchScheme(name, schemes[name], credentials) }))
    const unmet = perScheme.filter((s) => s.matches.length === 0).map((s) => s.name)
    return { perScheme, unmet }
  })

  const satisfied = evaluated.find((g) => g.unmet.length === 0)
  if (satisfied) {
    return { requiredSchemes, satisfiedBy: satisfied.perScheme.flatMap((s) => s.matches), unsatisfied: [] }
  }
  // None fully satisfiable — block on the closest group (fewest unmet; ties keep order).
  let closest = evaluated[0]
  for (const g of evaluated) if (g.unmet.length < closest.unmet.length) closest = g
  return { requiredSchemes, satisfiedBy: [], unsatisfied: closest.unmet }
}

/**
 * A content key over an operation section's security inputs that are NOT already in
 * its `canonicalText` — the effective OR-of-AND scheme groups (which fold the
 * doc-level `security` fallback) and the resolved definitions of the schemes they
 * reference (`components.securitySchemes`, invisible to the section fingerprint). `''`
 * for a non-operation or PUBLIC section, so an unsecured section is byte-identical to
 * before B7. Credential mapping is NOT folded here — the recipe fingerprint already
 * re-plans every section on any credential/`satisfies` change; this key's job is to
 * make a scheme-DEFINITION edit (otherwise invisible) re-plan the secured section.
 */
export function securityFingerprintForSection(section: SectionInput, doc: OpenApiDoc | null): string {
  const operation = sectionOperation(section)
  if (operation === null) return ''
  const groups = effectiveOperationSecurity(doc, operation)
  if (groups.length === 0) return ''
  const schemes = parseSecuritySchemes(doc)
  const referenced: Record<string, SecurityScheme | null> = {}
  for (const name of new Set(groups.flat())) referenced[name] = schemes[name] ?? null
  const text = canonicalStringify({ groups, schemes: referenced })
  return 'sha256:' + createHash('sha256').update(text).digest('hex')
}
