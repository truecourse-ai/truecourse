/**
 * Realization MATCHING (stage `guard.match`) — the join between the two halves of
 * guard. A flow says WHAT to test (spec-derived, code-blind); an interface catalog
 * says HOW the code can be driven (code-derived, spec-blind). One call per (flow,
 * surface) reads the flow's milestones and that surface's catalog DIGEST — ids,
 * entry descriptors, step summaries; never code — and returns either an ordered
 * realization plan, explicit per-milestone gaps, or both.
 *
 * An empty catalog and a missing executable action are mapping gaps. Neither
 * establishes that the application lacks the behavior. Capability gaps identify
 * observations or fixtures the selected driver cannot provide. Valid portions
 * remain available for authoring while the remaining gaps stay visible.
 *
 * Every interface id the model returns is validated against the catalog and every
 * milestone against the flow — a plan is never trusted to name something real.
 * The cache lives under `.cache/guard/match` (derived, deletable), keyed on the
 * flow fingerprint + the surface's IDENTITY + the stage and format versions, so
 * an unchanged flow on a structurally unchanged surface costs nothing.
 * {@link planFlowMatching} is the ONE planner the runtime and the pre-flight
 * estimate share, so the estimate probes exactly the cache the run reads.
 */

import { createHash } from 'node:crypto'
import { getCacheEntry, getCacheEntryOrLegacy, setCacheEntry } from '@truecourse/llm'
import {
  GUARD_OBSERVATION_CAPABILITIES,
  isCreditsExhausted,
  verificationCapabilityGap,
  type GuardPrerequisiteTarget,
  verificationCasePreparation,
  interfaceEntryLabel,
  flowDriversToMatch,
  describeInterfaceTarget,
  describeWebLocator,
  interfaceFingerprint,
  interfaceStepLocator,
  type GuardDriverId,
  type GuardFlow,
  type GuardWebScope,
  type Interface,
  type InterfaceTargetedStep,
  type InterfaceStep,
} from '@truecourse/shared'
import { RealizationMatchSchema, type RealizationStep, type RealizationGap, type RealizationMatch } from './schemas.js'
import { LEGACY_MATCH_PROMPT_FINGERPRINT } from './legacy-prompt-fingerprints.js'
import {
  type InterfaceDigest,
  type MatchIssues,
  type MatchUserContext,
} from './prompts.js'
import { flattenZodError, quoteInvalidOutput } from './validate.js'
import type { MatchRunner } from './leaf-seams.js'
import { PROVIDER_CONTROL_VERSION, resolveProviderControl, type Recipe, type ResolvedProviderControl } from '@truecourse/guard-runner'

export const MATCH_CACHE_NAME = 'guard/match'

/** Runner-owned fixtures, resolved without exposing account values or application code. */
export function matchProviderControls(flow: GuardFlow, driver: GuardDriverId, targets: readonly GuardPrerequisiteTarget[], recipe: Recipe): ResolvedProviderControl[] {
  const controls = flow.milestones.flatMap(m => m.verification?.cases?.flatMap(c => c.providerControls ?? []) ?? [])
  return [...new Map(controls.map(c => {
    const resolved = resolveProviderControl(c, driver, targets, recipe)
    return [JSON.stringify(resolved), resolved] as const
  })).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, resolved]) => resolved)
}

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

/** One surface's interfaces, its IDENTITY (the cache key half) and the wider
 *  fingerprint that also folds the authored prose. */
export interface SurfaceCatalog {
  surface: GuardDriverId
  interfaces: Interface[]
  /** `sha256:…` over the surface's sorted interface fingerprints AND the
   *  authored `context` prose of each — everything the matcher is shown. */
  fingerprint: string
  /** {@link surfaceIdentityFingerprint} — what the match key folds. */
  identity: string
}

/**
 * The surface's IDENTITY: its interface ids with each one's structural
 * fingerprint, sorted. It is what a realization plan can actually depend on —
 * a route that moved, an interface that appeared or left — and it deliberately
 * excludes the authored `context` prose, so re-wording a purpose re-plans
 * nothing. A new interface id DOES move it: that is the event which should let
 * every flow on the surface reconsider its route.
 */
export function surfaceIdentityFingerprint(interfaces: readonly Interface[]): string {
  const body = interfaces.map((j) => `${j.id}:${j.fingerprint || interfaceFingerprint(j)}`).sort().join('\n')
  return `sha256:${createHash('sha256').update(body, 'utf-8').digest('hex')}`
}

/**
 * Group an interface catalog by surface (an interface's `type` IS the driver that would
 * run its scenarios) and fingerprint each group over its interfaces' own
 * fingerprints, sorted — so the value depends on the SET of surfaces a user can
 * reach, never on derivation order.
 *
 * RPC-DERIVED OPERATIONS ARE NOT CANDIDATES. A tRPC procedure composed
 * into `POST /api/trpc/viewer.bookings.create` is genuinely invocable, but its
 * body is the procedure's input schema in tRPC's own envelope, and whether a
 * scenario should be authored against that encoding is a decision this round did
 * not take. They stay in the catalog — the web context pack joins a screen's
 * `trpc.…` calls to exactly these ids — and stay out of the matcher, the
 * grounding hints and the surface fingerprint, so a repo that gains the RPC
 * derivation re-authors nothing.
 */
export function buildSurfaceCatalogs(interfaces: readonly Interface[]): Map<GuardDriverId, SurfaceCatalog> {
  const byType = new Map<GuardDriverId, Interface[]>()
  for (const iface of interfaces) {
    if (iface.procedure) continue
    const list = byType.get(iface.type)
    if (list) list.push(iface)
    else byType.set(iface.type, [iface])
  }
  const out = new Map<GuardDriverId, SurfaceCatalog>()
  for (const [surface, list] of byType) {
    const body = list
      .map((j) => `${j.fingerprint || interfaceFingerprint(j)}:${JSON.stringify(interfaceDigest(j).context ?? [])}`)
      .sort()
      .join('\n')
    out.set(surface, {
      surface,
      interfaces: list,
      fingerprint: `sha256:${createHash('sha256').update(body, 'utf-8').digest('hex')}`,
      identity: surfaceIdentityFingerprint(list),
    })
  }
  return out
}

/**
 * One interface's DIGEST — what the matcher is allowed to see. Id, title, the entry
 * descriptor, and one line per step naming its kind and surface-visible payload.
 * No file paths, no symbols, no source: the same surface-visible shape the interface
 * fingerprint hashes.
 */
export function interfaceDigest(iface: Interface): InterfaceDigest {
  return {
    id: iface.id,
    title: iface.title,
    entry: interfaceEntryLabel(iface.entry),
    steps: iface.steps.map(stepSummary),
    ...((iface.purpose || iface.at || iface.to || iface.startingState || iface.endState) ? {
      context: [
        ...(iface.purpose ? [`purpose: ${iface.purpose}`] : []),
        ...(iface.at ? [`at: ${iface.at}`] : []),
        ...(iface.to ? [`to: ${iface.to}`] : []),
        ...(iface.startingState ? [`requires state: ${iface.startingState}`] : []),
        ...(iface.endState ? [`leaves state: ${iface.endState}`] : []),
      ],
    } : {}),
  }
}

/** One step as a single digest line — kind plus its surface-visible payload. */
function stepSummary(step: InterfaceStep): string {
  switch (step.kind) {
    case 'invoke':
      return `invoke: ${step.command.join(' ')}${step.flags.length > 0 ? `  flags: ${step.flags.join(' ')}` : ''}`
    case 'request':
      return `request: ${step.method.toUpperCase()} ${step.path}`
    case 'navigate':
      return `navigate: ${step.route}`
    case 'press':
      return `press ${step.key}${step.target ? `: ${targetWords({ ...step, target: step.target })}` : ''}`
    case 'upload':
      return `upload ${JSON.stringify(step.file)}: ${targetWords(step)}`
    default:
      return `${step.kind}${step.kind === 'input' && step.mode ? ` (${step.mode})` : ''}: ${targetWords(step)}`
  }
}

/**
 * A targeted step's locator as the authoring prompt reads it. A role+name target
 * (and a role+name scope) reads as it always has — `button "Save" within dialog “Delete”`;
 * any other handle, a `pick` or a `css` is the scenario locator itself, as JSON, so
 * it is copied rather than translated.
 */
function targetWords(step: InterfaceTargetedStep): string {
  const locator = interfaceStepLocator(step)
  const named = (scope: GuardWebScope): boolean => 'role' in scope && scope.name !== undefined && scope.pick === undefined
  if (!named(step.target) || (step.within && !named(step.within))) return JSON.stringify(locator)
  return `${describeInterfaceTarget(step.target)}${step.within ? ` within ${describeWebLocator(step.within)}` : ''}`
}

// ---------------------------------------------------------------------------
// The driver adapter table (authoring-time translation)
// ---------------------------------------------------------------------------

/**
 * Translate one interface into the DRIVER's own verbs for the authoring prompt —
 * the adapter table applied exactly once, here, and never interpreted at run time:
 * `invoke` → cli `run`, `request` → api `request`, and the interaction kinds →
 * the web driver's verbs when it ships. The interface is the abstract program; the
 * committed scenario is the compiled artifact, in the driver's closed vocabulary.
 *
 * Steps a driver has no verb for still render (naming the interface step in its own
 * terms) rather than vanishing: a silently thinned realization would read to the
 * author as "this interface does less than it does".
 */
export function realizationLines(iface: Interface, driver: GuardDriverId): string[] {
  return iface.steps.map((step) => `${driverVerb(step, driver)}   (interface ${iface.id})`)
}

function driverVerb(step: InterfaceStep, driver: GuardDriverId): string {
  switch (step.kind) {
    case 'invoke': {
      const flags = step.flags.length > 0 ? `   accepts: ${step.flags.join(' ')}` : ''
      return driver === 'cli'
        ? `run: ${JSON.stringify(step.command)}${flags}`
        : `${stepSummary(step)}`
    }
    case 'request':
      return driver === 'api'
        ? `request: ${step.method.toUpperCase()} ${step.path}`
        : `${stepSummary(step)}`
    case 'navigate':
      return `navigate: ${step.route}`
    case 'input':
      return `${step.mode === 'select' ? 'select' : 'fill'}: ${targetWords(step)}`
    case 'press':
      return `press: ${step.key}${step.target ? ` on ${targetWords({ ...step, target: step.target })}` : ''}`
    case 'hover':
      return `hover: ${targetWords(step)}`
    case 'upload':
      // The file goes verbatim: it is the step's `file`, fixture reference and all.
      return `upload: ${JSON.stringify(step.file)} to ${targetWords(step)}`
    default:
      return `click: ${targetWords(step)}`
  }
}

// ---------------------------------------------------------------------------
// Cache key + planning (shared by the runtime and the pre-flight estimate)
// ---------------------------------------------------------------------------

/**
 * THE MATCH STAGE'S VERSION, bumped by hand. A reworded matching prompt does
 * not make a cached verdict wrong, so the prompt is not in the key; when a
 * prompt change fixes WRONG output, this is bumped in the same commit and every
 * flow re-matches.
 */
export const MATCH_STAGE_VERSION = 1

/**
 * A (flow, surface) match's content key: the stage version, the flow's milestone
 * composition, the surface's IDENTITY and the format version. Editing a doc that
 * moves the flow's fingerprint, or a code change that adds, removes or
 * restructures an interface, re-matches; nothing else does.
 *
 * The authored `context` prose is deliberately out. A plan the matcher already
 * returned still names interfaces that exist and still drives them the same way;
 * a reworded purpose can only suggest a more direct route, and a less direct
 * route is not a wrong test. {@link MATCH_CONTEXT_CACHE_NAME} counts how often a
 * verdict is served across such an edit, which is what would justify folding the
 * prose of the interfaces IN the plan later.
 */
export function matchCacheKey(
  flow: Pick<GuardFlow, 'fingerprint'>,
  catalog: Pick<SurfaceCatalog, 'surface' | 'identity'>,
  providerControls: readonly ResolvedProviderControl[] = [],
): string {
  return matchKeyOver(`match-v${MATCH_STAGE_VERSION}`, flow, catalog.surface, catalog.identity, providerControls)
}

/**
 * {@link matchCacheKey} under the two formulas that came before it, newest
 * first: the whole catalog fingerprint (authored prose included) under this
 * stage version, and the same fingerprint under the prompt fingerprint the key
 * used to fold. A miss reads them in turn, so no workspace pays to re-match
 * what it already has. Delete with the legacy hash.
 */
export function matchLegacyCacheKeys(
  flow: Pick<GuardFlow, 'fingerprint'>,
  catalog: Pick<SurfaceCatalog, 'surface' | 'fingerprint'>,
  providerControls: readonly ResolvedProviderControl[] = [],
): string[] {
  return [
    matchKeyOver(`match-v${MATCH_STAGE_VERSION}`, flow, catalog.surface, catalog.fingerprint, providerControls),
    matchKeyOver(LEGACY_MATCH_PROMPT_FINGERPRINT, flow, catalog.surface, catalog.fingerprint, providerControls),
  ]
}

function matchKeyOver(
  stage: string,
  flow: Pick<GuardFlow, 'fingerprint'>,
  surface: GuardDriverId,
  catalogFingerprint: string,
  providerControls: readonly ResolvedProviderControl[],
): string {
  return createHash('sha256')
    .update(
      [
        stage,
        'case-assignments-v2',
        JSON.stringify(GUARD_OBSERVATION_CAPABILITIES[surface] ?? []),
        JSON.stringify(providerControls.length ? [PROVIDER_CONTROL_VERSION, providerControls.map(c => JSON.stringify(c)).sort()] : []),
        surface,
        catalogFingerprint,
        flow.fingerprint,
      ].join('::'),
    )
    .digest('hex')
}

/**
 * The cache holding one marker per settled verdict, under the verdict's own
 * key: the catalog fingerprint the surface wore when the verdict was last seen.
 * A hit whose marker names a different fingerprint is a verdict served across a
 * context edit — the trade {@link matchCacheKey} makes, counted.
 */
const MATCH_CONTEXT_CACHE_NAME = 'guard/match-context'

/**
 * The cached verdict for one (flow, surface), re-validated against the live
 * catalog — `null` when nothing is cached (or the entry can no longer be trusted,
 * so the run would call). The pre-flight estimate reads it to reconstruct the
 * interfaces a flow grounds on WITHOUT calling the model, which is what lets it
 * compute the same per-flow inputs hash the run compares against the manifest.
 */
export async function readCachedMatch(
  repoRoot: string,
  flow: GuardFlow,
  catalog: SurfaceCatalog,
  cacheKey: string | undefined = undefined,
  providerControls: readonly ResolvedProviderControl[] = [],
): Promise<{ plan: RealizationPlan | null } | null> {
  cacheKey ??= matchCacheKey(flow, catalog, providerControls)
  if (!capabilityPartition(flow, catalog.surface).flow.milestones.length) return { plan: null }
  const cached = await getCacheEntryOrLegacy(repoRoot, MATCH_CACHE_NAME, cacheKey, ...matchLegacyCacheKeys(flow, catalog, providerControls))
  if (!cached) return null
  const parsed = RealizationMatchSchema.safeParse(cached)
  if (!parsed.success || parsed.data.unrealizable) return null
  const issues = matchReferenceIssues(flow, catalog, parsed.data)
  if (describeMatchIssues(issues)) return null
  const { steps } = validateMatch(flow, catalog, parsed.data.plan)
  return { plan: steps.length ? { surface: catalog.surface, steps, interfaces: pathOf(steps) } : null }
}

/** One planned (flow, surface) match — the estimate and the run read the same row. */
export interface MatchPairPlan {
  flowId: string
  surface: GuardDriverId
  cacheKey: string
  /** True when this pair's verdict is already cached (zero LLM calls). */
  cached: boolean
}

/** The matching stage's planned work: exact per-pair calls over the given surfaces. */
export interface MatchPlan {
  pairs: MatchPairPlan[]
  /** Exact number of matching calls a run will make (cache misses, re-asks aside). */
  calls: number
}

/**
 * Plan the matching stage against the real cache: one row per (flow, surface with
 * a non-empty catalog). The ONE planner — the runtime calls it to decide which
 * pairs need an LLM call, the pre-flight estimate calls it to count them.
 */
export async function planFlowMatching(
  repoRoot: string,
  flows: readonly GuardFlow[],
  catalogs: readonly SurfaceCatalog[],
  providerContext: (flow: GuardFlow, catalog: SurfaceCatalog) => readonly ResolvedProviderControl[] = () => [],
): Promise<MatchPlan> {
  const pairs: MatchPairPlan[] = []
  for (const flow of flows) {
    for (const catalog of catalogs) {
      if (catalog.interfaces.length === 0 || !flowDriversToMatch(flow).includes(catalog.surface)) continue
      const controls = providerContext(flow, catalog)
      const cacheKey = matchCacheKey(flow, catalog, controls)
      pairs.push({
        flowId: flow.id,
        surface: catalog.surface,
        cacheKey,
        cached: (await readCachedMatch(repoRoot, flow, catalog, cacheKey, controls)) !== null,
      })
    }
  }
  return { pairs, calls: pairs.filter((p) => !p.cached).length }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/** One milestone's realization: the interfaces chosen for it, in plan order. */
export interface RealizedMilestone {
  milestone: number
  interfaces: Interface[]
}

/** A flow's realization on ONE surface — the plan the authoring call is given. */
export interface RealizationPlan {
  surface: GuardDriverId
  /** The plan entries in the model's order, validated against flow + catalog. */
  steps: { interface: Interface; milestone: number; checks?: string[]; note?: string }[]
  /** The distinct interfaces the plan walks, in first-use order — the scenario's `interface.path`. */
  interfaces: Interface[]
}

/**
 * A flow's verdict on one surface: a plan, a stated refusal, or a stage failure.
 * `contextMoved` marks a verdict SERVED FROM CACHE although the surface's
 * authored prose had moved since it was stored — the key folds the surface's
 * identity alone, so the flow kept a plan an edited catalog might have changed.
 */
export type MatchOutcome =
  | { kind: 'plan'; plan: RealizationPlan; gaps: RealizationGap[]; calls: number; contextMoved?: true }
  | { kind: 'gap'; gaps: RealizationGap[]; calls: number; contextMoved?: true }
  | { kind: 'error'; reason: string; calls: number }

/** Validation of one raw match reply against the flow and the surface's catalog. */
interface MatchValidation {
  steps: { interface: Interface; milestone: number; checks?: string[]; note?: string }[]
  issues: MatchIssues
}

function validateMatch(
  flow: GuardFlow,
  catalog: SurfaceCatalog,
  raw: readonly RealizationStep[],
): MatchValidation {
  const byId = new Map(catalog.interfaces.map((j) => [j.id, j]))
  const milestoneOrders = new Set(flow.milestones.map((m) => m.order))
  const issues: MatchIssues = { unknownInterfaces: [], uncoveredMilestones: [], unknownMilestones: [] }
  const steps: { interface: Interface; milestone: number; checks?: string[]; note?: string }[] = []
  const covered = new Set<number>()

  for (const entry of raw) {
    const iface = byId.get(entry.interfaceId.trim())
    if (!iface) {
      if (!issues.unknownInterfaces.includes(entry.interfaceId)) issues.unknownInterfaces.push(entry.interfaceId)
      continue
    }
    if (!milestoneOrders.has(entry.milestone)) {
      if (!issues.unknownMilestones.includes(entry.milestone)) issues.unknownMilestones.push(entry.milestone)
      continue
    }
    const required = flow.milestones.find((m) => m.order === entry.milestone)?.proofDrivers
    if (required && !required.includes(catalog.surface)) continue
    covered.add(entry.milestone)
    steps.push({ interface: iface, milestone: entry.milestone, ...(entry.checks ? { checks: entry.checks } : {}), ...(entry.note ? { note: entry.note } : {}) })
  }
  issues.uncoveredMilestones = flow.milestones.map((m) => m.order).filter((order) => !covered.has(order))
  return { steps, issues }
}

/** The plan's distinct interfaces in first-use order — the scenario's interface path. */
function pathOf(steps: readonly { interface: Interface }[]): Interface[] {
  const seen = new Set<string>()
  const out: Interface[] = []
  for (const s of steps) {
    if (seen.has(s.interface.id)) continue
    seen.add(s.interface.id)
    out.push(s.interface)
  }
  return out
}

/** Missing catalog coverage after the bounded correction. */
function uncoveredReason(flow: GuardFlow, orders: readonly number[]): string {
  const titles = orders
    .map((order) => flow.milestones.find((m) => m.order === order)?.claimTitle ?? `milestone ${order}`)
    .map((t) => `"${t.replace(/\s+/g, ' ').trim()}"`)
  return `no interface realizes ${orders.length === 1 ? 'milestone' : 'milestones'} ${orders.join(', ')} — ${titles.join('; ')}`
}

function buildContext(flow: GuardFlow, catalog: SurfaceCatalog, providerControls: readonly ResolvedProviderControl[]): MatchUserContext {
  return {
    flow: { id: flow.id, title: flow.title, goal: flow.goal },
    milestones: flow.milestones
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((m) => ({ order: m.order, claim: m.claimTitle, ...(m.verification ? { verification: m.verification } : {}), ...(m.note ? { note: m.note } : {}) })),
    surface: catalog.surface,
    capabilities: GUARD_OBSERVATION_CAPABILITIES[catalog.surface] ?? [],
    providerControls,
    interfaces: catalog.interfaces.map(interfaceDigest),
  }
}

/** Cases are assigned independently; multiple grounded actions may serve one case. */
function obligationKeys(milestone: number, checks?: readonly string[]): string[] {
  return checks?.map(c => `${milestone}/${c}`) ?? [String(milestone)]
}

function eligibleMilestones(flow: GuardFlow, surface: GuardDriverId) {
  return flow.milestones.filter(m => !m.proofDrivers || m.proofDrivers.includes(surface))
}

function missingDispositions(flow: GuardFlow, catalog: SurfaceCatalog, data: RealizationMatch): { milestone: number; checks?: string[] }[] {
  const assigned = new Set([...data.plan, ...data.gaps].flatMap(p => obligationKeys(p.milestone, p.checks)))
  return eligibleMilestones(flow, catalog.surface).flatMap(m => {
    const cases = m.verification?.cases
    if (cases?.length) {
      const checks = cases.filter(c => !assigned.has(`${m.order}/${c.id}`)).map(c => c.id)
      return checks.length ? [{ milestone: m.order, checks }] : []
    }
    return assigned.has(String(m.order)) ? [] : [{ milestone: m.order }]
  })
}

/** Give the corrective call and the persisted error the same actionable details. */
function matchReferenceIssues(flow: GuardFlow, catalog: SurfaceCatalog, data: RealizationMatch): MatchIssues {
  const issues = validateMatch(flow, catalog, data.plan).issues
  const byOrder = new Map(flow.milestones.map(m => [m.order, m]))
  const planned = new Set(data.plan.flatMap(p => obligationKeys(p.milestone, p.checks)))
  const seen = new Set<string>()
  const gapErrors: string[] = []
  for (const [kind, entries] of [['plan', data.plan], ['gap', data.gaps]] as const) {
    for (const entry of entries) {
      const m = byOrder.get(entry.milestone)
      if (!m) {
        if (kind === 'gap') gapErrors.push(`gap names unknown milestone ${entry.milestone}`)
      } else {
        const cases = m.verification?.cases
        if (cases?.length && !entry.checks?.length) gapErrors.push(`${kind} milestone ${m.order} must name explicit checks`)
        if (!cases?.length && entry.checks?.length) gapErrors.push(`${kind} milestone ${m.order} has no case metadata; omit checks`)
        for (const check of entry.checks ?? []) if (!cases?.some(c => c.id === check)) gapErrors.push(`${kind} milestone ${m.order} names unknown check ${check}`)
        if (entry.checks && new Set(entry.checks).size !== entry.checks.length) gapErrors.push(`${kind} milestone ${m.order} repeats a check`)
        if (m.proofDrivers && !m.proofDrivers.includes(catalog.surface)) gapErrors.push(`${kind} milestone ${m.order} does not accept ${catalog.surface} proof`)
        if (kind === 'plan') {
          const reason = verificationCapabilityGap(m.verification, catalog.surface, entry.checks)
          if (reason) gapErrors.push(`milestone ${entry.milestone} cannot be planned: ${reason}`)
        }
        if (kind === 'gap' && (entry as RealizationGap).kind === 'capability' && m.verification) {
          const checks = entry.checks ?? [undefined]
          for (const check of checks) {
            if (!verificationCapabilityGap(m.verification, catalog.surface, check ? [check] : undefined)) {
              gapErrors.push(`milestone ${m.order}${check ? ` check ${check}` : ''}: capability gap contradicts the runner registry; all declared observations are supported. Provider fixtures are runner-owned and need no catalog interface. Ground the app action, or name a genuinely missing app action as a mapping gap.`)
            }
          }
        }
      }
      if (kind === 'gap') for (const key of obligationKeys(entry.milestone, entry.checks)) {
        const label = entry.checks ? `milestone ${entry.milestone} check ${key.split('/')[1]}` : `milestone ${entry.milestone}`
        if (planned.has(key)) gapErrors.push(`${label} appears in both plan and gaps; use one disposition`)
        if (seen.has(key)) gapErrors.push(`${label} has duplicate gaps; combine the reasons into one gap`)
        seen.add(key)
      }
    }
  }
  const missing = missingDispositions(flow, catalog, data)
  gapErrors.push(...missing.filter(m => m.checks).map(m => `milestone ${m.milestone} has unaccounted checks: ${m.checks!.join(', ')}`))
  return { ...issues, uncoveredMilestones: missing.filter(m => !m.checks).map(m => m.milestone), gapErrors }
}

/** Preserve independent assignments only after every action for their case validates.
 * An invalid action can be setup for a later valid action, so remove the entire
 * affected case instead of silently shortening its realization.
 */
function independentMatchPortions(flow: GuardFlow, catalog: SurfaceCatalog, data: RealizationMatch): RealizationMatch {
  const unsafe = new Set<string>()
  const planned = new Set(data.plan.flatMap(entry => obligationKeys(entry.milestone, entry.checks)))
  const gapsSeen = new Set<string>()
  for (const gap of data.gaps) {
    for (const key of obligationKeys(gap.milestone, gap.checks)) {
      if (planned.has(key) || gapsSeen.has(key)) unsafe.add(key)
      gapsSeen.add(key)
    }
  }
  for (const [kind, entries] of [['plan', data.plan], ['gap', data.gaps]] as const) {
    for (const entry of entries) {
      const isolated = kind === 'plan' ? { plan: [entry as RealizationStep], gaps: [] }
        : { plan: [], gaps: [entry as RealizationGap] }
      const issues = matchReferenceIssues(flow, catalog, { ...isolated, unrealizable: undefined })
      const invalid = issues.unknownInterfaces.length || issues.unknownMilestones.length ||
        issues.gapErrors?.some(error => !error.includes('has unaccounted checks:'))
      if (!invalid) continue
      const milestone = flow.milestones.find(m => m.order === entry.milestone)
      // A missing checks list is ambiguous across every case of that milestone.
      const checks = entry.checks ?? milestone?.verification?.cases?.map(c => c.id)
      for (const key of obligationKeys(entry.milestone, checks)) unsafe.add(key)
    }
  }
  // Shared actions couple their checks: removing setup for one also invalidates
  // every sibling that depended on that action, including indirect chains.
  let expanded = true
  while (expanded) {
    expanded = false
    for (const entry of data.plan) {
      const keys = obligationKeys(entry.milestone, entry.checks)
      if (!keys.some(key => unsafe.has(key))) continue
      for (const key of keys) if (!unsafe.has(key)) { unsafe.add(key); expanded = true }
    }
  }
  const safe = (entry: RealizationStep | RealizationGap) =>
    !obligationKeys(entry.milestone, entry.checks).some(key => unsafe.has(key))
  return { plan: data.plan.filter(safe), gaps: data.gaps.filter(safe), unrealizable: undefined }
}

/** Remove only cases whose observations the selected driver cannot provide. */
function capabilityPartition(flow: GuardFlow, surface: GuardDriverId): { flow: GuardFlow; gaps: RealizationGap[] } {
  const gaps: RealizationGap[] = []
  const milestones = eligibleMilestones(flow, surface).flatMap(m => {
    const verification = m.verification
    if (verification?.cases?.length) {
      const cases = verification.cases.filter(c => {
        const reason = verificationCapabilityGap(verification, surface, [c.id])
        if (reason) gaps.push({ milestone: m.order, checks: [c.id], kind: 'capability', reason })
        return !reason
      })
      return cases.length ? [{ ...m, verification: { ...verification, cases } }] : []
    }
    const reason = verificationCapabilityGap(verification, surface)
    if (reason) gaps.push({ milestone: m.order, kind: 'capability', reason })
    return reason ? [] : [m]
  })
  return { flow: { ...flow, milestones }, gaps }
}

function describeMatchIssues(issues: MatchIssues): string {
  return [
    ...(issues.unknownInterfaces.length ? [`unknown interface ids: ${issues.unknownInterfaces.join(', ')}`] : []),
    ...(issues.unknownMilestones.length ? [`unknown milestone numbers: ${issues.unknownMilestones.join(', ')}`] : []),
    ...(issues.gapErrors ?? []),
    ...(issues.uncoveredMilestones.length ? [`unaccounted milestones: ${issues.uncoveredMilestones.join(', ')}`] : []),
  ].join('; ')
}

/**
 * Match ONE flow against ONE surface's catalog: cache → call → exactly one
 * corrective re-ask on an invalid or unusable answer. A surface whose catalog is
 * empty must never reach here (the caller settles it as `no-interface`) — matching
 * with nothing to choose from could only produce noise.
 */
export async function matchFlow(
  repoRoot: string,
  flow: GuardFlow,
  catalog: SurfaceCatalog,
  runner: MatchRunner,
  cacheKey: string | undefined = undefined,
  providerControls: readonly ResolvedProviderControl[] = [],
): Promise<MatchOutcome> {
  cacheKey ??= matchCacheKey(flow, catalog, providerControls)
  const { flow: matchableFlow, gaps: capabilityGaps } = capabilityPartition(flow, catalog.surface)
  if (matchableFlow.milestones.length === 0) return { kind: 'gap', gaps: capabilityGaps, calls: 0 }
  const base = buildContext(matchableFlow, catalog, providerControls)
  const settle = (data: RealizationMatch, calls: number, repairMissing = false): MatchOutcome | null => {
    const rawGaps: RealizationGap[] = data.unrealizable
      ? matchableFlow.milestones.map(m => ({ milestone: m.order,
        ...(m.verification?.cases?.length ? { checks: m.verification.cases.map(c => c.id) } : {}),
        kind: 'mapping', reason: data.unrealizable! }))
      : [...data.gaps]
    // Cached rows already contain deterministic capability gaps; append only ones
    // not already represented, so fresh responses and cache replay share validation.
    const represented = new Set(rawGaps.flatMap(g => obligationKeys(g.milestone, g.checks)))
    const gaps = [...rawGaps, ...capabilityGaps.filter(g => obligationKeys(g.milestone, g.checks).some(k => !represented.has(k)))]
    const combined = { ...data, gaps }
    const missing = missingDispositions(flow, catalog, combined)
    if (repairMissing) for (const entry of missing) {
      const milestone = flow.milestones.find(m => m.order === entry.milestone)!
      const claims = entry.checks?.map(id => milestone.verification!.cases!.find(c => c.id === id)!.claim).join('; ')
      gaps.push({ ...entry, kind: 'mapping', reason: `${uncoveredReason(flow, [entry.milestone])}${claims ? ` — missing cases: ${claims}` : ''}. Reconcile the interface catalog against ${milestone.doc}#${milestone.anchor}; preserve the existing mapped actions.` })
    }
    const issues = matchReferenceIssues(flow, catalog, combined)
    if (describeMatchIssues(issues)) return null
    const v = validateMatch(flow, catalog, data.plan)
    return v.steps.length
      ? { kind: 'plan', plan: { surface: catalog.surface, steps: v.steps, interfaces: pathOf(v.steps) }, gaps, calls }
      : { kind: 'gap', gaps, calls }
  }

  // The context marker: the catalog fingerprint this verdict was last seen
  // under, written beside every settled verdict and re-stamped on every hit.
  const markContext = (): Promise<void> =>
    setCacheEntry(repoRoot, MATCH_CONTEXT_CACHE_NAME, cacheKey!, { catalog: catalog.fingerprint })

  const cached = await getCacheEntryOrLegacy(repoRoot, MATCH_CACHE_NAME, cacheKey, ...matchLegacyCacheKeys(flow, catalog, providerControls))
  if (cached) {
    const parsed = RealizationMatchSchema.safeParse(cached)
    if (parsed.success && !parsed.data.unrealizable) {
      const settled = settle(parsed.data, 0)
      if (settled) {
        const marker = (await getCacheEntry(repoRoot, MATCH_CONTEXT_CACHE_NAME, cacheKey)) as { catalog?: unknown } | null
        // A verdict cached before the marker existed gets one now and says
        // nothing: what the surface read then is unknown, not unchanged.
        const moved = marker !== null && marker.catalog !== catalog.fingerprint
        if (marker === null || moved) await markContext()
        return moved && settled.kind !== 'error' ? { ...settled, contextMoved: true } : settled
      }
    }
  }

  let calls = 0
  let retained: Extract<MatchOutcome, { kind: 'plan' }> | undefined
  const retainedWithError = (reason: string): MatchOutcome | undefined => retained && ({ ...retained, calls, gaps: retained.gaps.map(g => ({ ...g, reason: `${g.reason} Matcher correction failed: ${reason}` })) })
  let ctx: MatchUserContext = base
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown
    try { calls++; raw = await runner(ctx) }
    // An empty balance is not this pair's verdict: softening it would settle the
    // pair as "no match", tick the step done over work that never ran, and leave
    // nothing in the cache for the resume to replay. It travels.
    catch (e) { if (isCreditsExhausted(e)) throw e; return retainedWithError((e as Error).message) ?? { kind: 'error', reason: `match call failed: ${(e as Error).message}`, calls } }
    const parsed = RealizationMatchSchema.safeParse(raw)
    if (!parsed.success) {
      if (attempt > 0) return retainedWithError(flattenZodError(parsed.error)) ?? { kind: 'error', reason: `match output invalid after re-ask: ${flattenZodError(parsed.error)}; output: ${quoteInvalidOutput(raw)}`, calls }
      ctx = { ...base, correction: { invalidOutput: `${flattenZodError(parsed.error)}\n${quoteInvalidOutput(raw)}\nPreserve valid portions for the eligible milestone/check IDs listed above. Use plan and gaps only; never combine them with unrealizable.` } }
      continue
    }
    // A refusal gets one bounded re-ask: preserve whatever can be verified and
    // identify missing catalog actions explicitly. Neither reply inspects code.
    if (parsed.data.unrealizable && attempt === 0) {
      ctx = { ...base, correction: { invalidOutput: `${quoteInvalidOutput(raw)}\nA missing catalog action does not establish absent application behavior. Return any grounded plan portions plus per-milestone mapping/capability gaps. Do not invent actions.` } }
      continue
    }
    const settled = settle(parsed.data, calls, attempt > 0)
    if (settled) {
      const data = settled.kind === 'plan'
        ? { plan: settled.plan.steps.map((s) => ({ interfaceId: s.interface.id, milestone: s.milestone, ...(s.checks ? { checks: s.checks } : {}), ...(s.note ? { note: s.note } : {}) })), gaps: settled.gaps }
        : settled.kind === 'gap' ? { gaps: settled.gaps } : null
      if (!data || settled.kind === 'error') return settled
      await setCacheEntry(repoRoot, MATCH_CACHE_NAME, cacheKey, data)
      await markContext()
      return settled
    }
    const partial = settle(independentMatchPortions(matchableFlow, catalog, parsed.data), calls, true)
    if (partial?.kind === 'plan') retained = partial
    const issues = matchReferenceIssues(matchableFlow, catalog, parsed.data)
    if (attempt > 0) return retainedWithError(describeMatchIssues(issues)) ?? { kind: 'error', reason: `match references invalid after re-ask: ${describeMatchIssues(issues)}; output: ${quoteInvalidOutput(raw)}`, calls }
    ctx = { ...base, issues,
      correction: { invalidOutput: quoteInvalidOutput(raw) } }
  }
  return { kind: 'error', reason: 'match exhausted its attempts', calls }
}

/** Stable ordered action/case assignment shared by generation and cost estimation. */
export function realizationAssignmentFingerprint(plan: RealizationPlan): string {
  return createHash('sha256').update(JSON.stringify(plan.steps.map(s => [s.milestone, [...(s.checks ?? [])].sort(), s.interface.id]))).digest('hex')
}

/** Preparation removes only cases that cannot acquire their required starting state. */
export function partitionPlanPreparations(
  flow: GuardFlow,
  plan: RealizationPlan,
  available: readonly { baseline: 'empty' | 'seeded' }[],
): { plan: RealizationPlan | null; missing: { milestone: number; caseId: string; requirement: 'empty' | 'controlled' }[] } {
  const missing = new Map<string, { milestone: number; caseId: string; requirement: 'empty' | 'controlled' }>()
  const steps = plan.steps.flatMap(step => {
    if (!step.checks) return [step]
    const milestone = flow.milestones.find(m => m.order === step.milestone)
    const checks = step.checks.filter(id => {
      const c = milestone?.verification?.cases?.find(c => c.id === id)
      const requirement = c && verificationCasePreparation(c)
      if (!requirement || available.some(p => requirement === 'controlled' || p.baseline === 'empty')) return true
      missing.set(`${step.milestone}:${id}`, { milestone: step.milestone, caseId: id, requirement })
      return false
    })
    return checks.length ? [{ ...step, checks }] : []
  })
  return { plan: steps.length ? { ...plan, steps, interfaces: plan.interfaces.filter(i => steps.some(s => s.interface.id === i.id)) } : null,
    missing: [...missing.values()] }
}

/** One realization must cover the entire immutable flow before authoring. */
export function completeRealization(flow: GuardFlow, plan: RealizationPlan): boolean {
  return flow.milestones.every(m => (!m.proofDrivers || m.proofDrivers.includes(plan.surface)) &&
    (m.verification?.cases?.length
      ? m.verification.cases.every(c => plan.steps.some(s => s.milestone === m.order && s.checks?.includes(c.id)))
      : plan.steps.some(s => s.milestone === m.order)))
}
