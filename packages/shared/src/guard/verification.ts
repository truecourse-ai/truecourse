import { GuardPrerequisiteSchema } from './prerequisites.js'
import { z } from 'zod'
import type { GuardDriverId } from './drivers.js'

export const GuardVerificationCapabilitySchema = z.enum([
  'browser', 'http', 'process', 'filesystem', 'datastore', 'concurrency', 'implementation', 'request-control', 'provider-control', 'own-request-control', 'browser-timezone-control',
])
export type GuardVerificationCapability = z.infer<typeof GuardVerificationCapabilitySchema>
export const GUARD_PROVIDER_CONTROL_OPERATIONS = [
  'response', 'header-delay', 'body-delay', 'reset', 'sequence', 'request-assertions', 'call-count',
] as const
export const GuardProviderControlSchema = z.object({
  service: z.string().min(1),
  operations: z.array(z.enum(GUARD_PROVIDER_CONTROL_OPERATIONS)).min(1),
  originalNames: z.array(z.string().min(1)).optional(),
}).strict()
export type GuardProviderControl = z.infer<typeof GuardProviderControlSchema>
export const GuardVerificationCaseSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  claim: z.string().min(1),
  method: z.enum(['behavior', 'filesystem', 'datastore', 'concurrency', 'implementation']),
  requires: z.array(GuardVerificationCapabilitySchema).min(1),
  prerequisites: z.array(GuardPrerequisiteSchema).optional(),
  providerControls: z.array(GuardProviderControlSchema).min(1).optional(),
  /** Traffic named by a request-count/inspection claim, independent of fixture setup. */
  requestBoundary: z.enum(['browser-to-app', 'app-to-provider']).optional(),
  /** Exact server-startup contract for a web/HTTP proof; ordinary CLI steps carry their own commands. */
  invocation: z.object({ command: z.string().min(1), address: z.string().url().optional() }).strict().optional(),
  /** Required scenario baseline, independent of observation capabilities. */
  preparation: z.enum(['empty', 'controlled']).optional(),
  /** Conditions to arrange, not evidence that must be read from a database. */
  conditions: z.array(z.enum(['fresh-state', 'request-failure', 'request-pending'])),
}).strict().superRefine((c, ctx) => {
  if (c.requestBoundary === 'browser-to-app' && !c.requires.includes('own-request-control')) {
    ctx.addIssue({ code: 'custom', path: ['requires'], message: 'browser-to-app request evidence requires own-request-control; provider counts cannot prove it.' })
  }
  if (c.requestBoundary === 'app-to-provider' && !c.requires.includes('provider-control')) {
    ctx.addIssue({ code: 'custom', path: ['requires'], message: 'app-to-provider request evidence requires provider-control and a named provider.' })
  }
  if (c.requires.includes('provider-control') !== !!c.providerControls?.length) {
    ctx.addIssue({ code: 'custom', path: ['providerControls'], message: 'provider-control requires named providerControls; providerControls requires provider-control.' })
  }
})

/** What evidence proves a claim, independently of the transport used to drive it. */
export const GuardVerificationSchema = z.object({
  method: z.enum(['behavior', 'filesystem', 'datastore', 'concurrency', 'implementation']),
  observable: z.string().min(1),
  /** Optional only for artifacts generated before explicit obligation accounting. */
  scope: z.enum(['web', 'api', 'configuration', 'implementation']).optional(),
  cases: z.array(GuardVerificationCaseSchema).min(1).optional(),
}).strict()
export type GuardVerification = z.infer<typeof GuardVerificationSchema>

/** A closed registry of observations the existing executors implement. Installing
 * a service never grants the runner a new observation or fault-injection verb. */
export const GUARD_OBSERVATION_CAPABILITIES: Partial<Record<GuardDriverId, readonly GuardVerificationCapability[]>> = {
  cli: ['process', 'filesystem'], api: ['http', 'process', 'provider-control'], web: ['browser', 'http', 'provider-control'],
}

export function verificationRequirements(verification: GuardVerification | undefined, checks?: readonly string[]): GuardVerificationCapability[] {
  if (!verification) return []
  const required = verification.cases?.filter(c => !checks || checks.includes(c.id)).flatMap(c => [
    ...c.requires,
    // Legacy artifacts remain readable, but ambiguous traffic counts are not proof.
    ...(!c.requestBoundary && c.providerControls?.some(p => p.operations.some(op => op === 'call-count' || op === 'request-assertions')) ? ['request-control' as const] : []),
    ...(c.requestBoundary === 'browser-to-app' ? ['own-request-control' as const] : []),
  ]) ?? []
  // Internal evidence cannot be bypassed by declaring only a convenient transport.
  if (verification.method !== 'behavior') required.push(verification.method)
  return [...new Set(required)]
}

export function verificationCapabilityGap(verification: GuardVerification | undefined, driver: GuardDriverId, checks?: readonly string[]): string | undefined {
  const supported = GUARD_OBSERVATION_CAPABILITIES[driver] ?? []
  const missing = verificationRequirements(verification, checks).filter(c => !supported.includes(c))
  return missing.length ? `Unsupported observation: ${missing.join(', ')} on the ${driver} driver. ${verification!.observable}${missing.includes('request-control') ? ' Re-extract this legacy or ambiguous case to distinguish provider-control from own-request-control and declare requestBoundary for request counts or inspection.' : ''}` : undefined
}

/** Structured boundary checks, never keyword guesses about application prose. */
export function verificationBoundaryProblems(v: GuardVerification | undefined, requireCases = false, drivers?: readonly GuardDriverId[]): string[] {
  if (!v?.scope || !v.cases?.length) return requireCases ? ['Declare a verification scope and explicit cases for this obligation.'] : []
  const problems: string[] = []
  for (const c of v.cases) {
    if (!c.requestBoundary && c.providerControls?.some(p => p.operations.some(op => op === 'call-count' || op === 'request-assertions'))) {
      problems.push(`Case ${c.id}: declare requestBoundary as browser-to-app or app-to-provider for request counts or inspection. Preserve the boundary named by the source claim; provider counters cannot prove browser-to-app traffic.`)
    }
  }
  if (v.scope === 'web' && drivers?.some(d => d !== 'web')) problems.push('A web-scoped obligation accepts web proof only; an API or CLI alternative cannot prove UI behavior.')
  if (v.scope === 'api' && drivers?.some(d => d !== 'api')) problems.push('An API-scoped obligation accepts API proof only; preserve UI behavior as a separate web obligation.')
  if (new Set(v.cases.map(c => c.id)).size !== v.cases.length) problems.push('Case ids must be unique within the obligation.')
  if (v.cases.some(c => c.method !== v.method)) problems.push('Split behavior and internal observations into separate claims; all cases must share the obligation method.')
  const conditions = new Set(v.cases.map(c => [...c.conditions].sort().join(',')))
  if (conditions.size > 1) problems.push('Split independent branches with different starting or failure conditions into separate claims.')
  if (v.scope === 'web' && (v.method !== 'behavior' || v.cases.some(c => c.requires.some(r => !['browser', 'request-control', 'provider-control', 'own-request-control', 'browser-timezone-control'].includes(r))))) {
    problems.push('A web obligation observes the UI. Move protocol, filesystem and database assertions to separate obligations; test persistence through reload or a fresh browser context.')
  }
  if (v.scope === 'api' && v.cases.some(c => c.requires.includes('browser'))) problems.push('API obligations cannot prove browser presentation or interaction; preserve those as separate web obligations.')
  if (v.scope === 'api' && v.method !== 'behavior') problems.push('Move internal storage or implementation guarantees out of the API behavior obligation.')
  if (v.cases.some(c => c.conditions.some(x => x === 'request-failure' || x === 'request-pending') && !c.requires.some(r => ['request-control', 'provider-control', 'own-request-control'].includes(r)))) {
    problems.push('Controlled request failure or delay requires provider-control or own-request-control capability, not a database dependency.')
  }
  return problems
}

export function verificationGroup(v: GuardVerification | undefined): string | undefined {
  if (!v) return undefined
  return JSON.stringify([v.scope ?? (v.method === 'behavior' ? 'behavior' : 'implementation'), v.method,
    [...new Set(v.cases?.flatMap(c => c.conditions) ?? [])].sort()])
}

export const GuardBlockerSchema = z.object({
  kind: z.enum(['unsupported-capability', 'configuration', 'generation']),
  capabilities: z.array(GuardVerificationCapabilitySchema).optional(),
  action: z.string().min(1).optional(),
  dependencies: z.array(z.string().min(1)).optional(),
}).strict()

/** Stable identity of a required case; caseId is absent only for legacy milestones. */
export const GuardObligationRefSchema = z.object({
  milestone: z.number().int().positive(),
  caseId: z.string().min(1).optional(),
}).strict()
export type GuardObligationRef = z.infer<typeof GuardObligationRefSchema>

/** Preserve historical fresh-state requirements when new preparation metadata is absent. */
export function verificationCasePreparation(c: { preparation?: 'empty' | 'controlled'; conditions: readonly string[] }): 'empty' | 'controlled' | undefined {
  return c.conditions.includes('fresh-state') ? 'empty' : c.preparation
}
