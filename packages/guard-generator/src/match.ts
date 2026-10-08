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
  ANONYMOUS_PRINCIPAL,
  isCreditsExhausted,
  interfaceEntryLabel,
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

export const MATCH_CACHE_NAME = 'guard/match'

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
 *
 * A task the catalog says is performed as a principal opens with who that is
 * ({@link principalLine}), so the scenario signs in as it.
 */
export function realizationLines(iface: Interface, driver: GuardDriverId): string[] {
  const lines = iface.steps.map((step) => driverVerb(step, driver))
  return [...(iface.principal ? [principalLine(iface.principal)] : []), ...lines].map(
    (line) => `${line}   (interface ${iface.id})`,
  )
}

/**
 * Who a task is performed as, when the catalog names it: the credential a
 * scenario of it signs in with, or none for a task done signed out. Never part
 * of a fingerprint — who performs a task is not WHICH task it is.
 */
function principalLine(principal: string): string {
  return principal === ANONYMOUS_PRINCIPAL ? 'signed out: no credential' : `performed as: ${principal}`
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
): string {
  return matchKeyOver(`match-v${MATCH_STAGE_VERSION}`, flow, catalog.surface, catalog.identity)
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
): string[] {
  return [
    matchKeyOver(`match-v${MATCH_STAGE_VERSION}`, flow, catalog.surface, catalog.fingerprint),
    matchKeyOver(LEGACY_MATCH_PROMPT_FINGERPRINT, flow, catalog.surface, catalog.fingerprint),
  ]
}

function matchKeyOver(
  stage: string,
  flow: Pick<GuardFlow, 'fingerprint'>,
  surface: GuardDriverId,
  catalogFingerprint: string,
): string {
  return createHash('sha256')
    .update([stage, surface, catalogFingerprint, flow.fingerprint].join('::'))
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
): Promise<{ plan: RealizationPlan | null } | null> {
  cacheKey ??= matchCacheKey(flow, catalog)
  const cached = await getCacheEntryOrLegacy(repoRoot, MATCH_CACHE_NAME, cacheKey, ...matchLegacyCacheKeys(flow, catalog))
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
): Promise<MatchPlan> {
  const pairs: MatchPairPlan[] = []
  for (const flow of flows) {
    for (const catalog of catalogs) {
      if (catalog.interfaces.length === 0) continue
      const cacheKey = matchCacheKey(flow, catalog)
      pairs.push({
        flowId: flow.id,
        surface: catalog.surface,
        cacheKey,
        cached: (await readCachedMatch(repoRoot, flow, catalog, cacheKey)) !== null,
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

/** One plan entry: the interface that realizes a milestone, with the matcher's note. */
export interface RealizationPlanStep {
  interface: Interface
  milestone: number
  note?: string
}

/** A flow's realization on ONE surface — the plan the authoring call is given. */
export interface RealizationPlan {
  surface: GuardDriverId
  /** The plan entries in the model's order, validated against flow + catalog. */
  steps: RealizationPlanStep[]
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
  steps: RealizationPlanStep[]
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
  const steps: RealizationPlanStep[] = []
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
    covered.add(entry.milestone)
    steps.push({ interface: iface, milestone: entry.milestone, ...(entry.note ? { note: entry.note } : {}) })
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

function buildContext(flow: GuardFlow, catalog: SurfaceCatalog): MatchUserContext {
  return {
    flow: { id: flow.id, title: flow.title, goal: flow.goal },
    milestones: flow.milestones
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((m) => ({ order: m.order, claim: m.claimTitle, ...(m.note ? { note: m.note } : {}) })),
    surface: catalog.surface,
    interfaces: catalog.interfaces.map(interfaceDigest),
  }
}

/** The milestones neither planned nor gapped. */
function missingMilestones(flow: GuardFlow, data: RealizationMatch): number[] {
  const assigned = new Set([...data.plan, ...data.gaps].map(p => p.milestone))
  return flow.milestones.map(m => m.order).filter(order => !assigned.has(order))
}

/** Give the corrective call and the persisted error the same actionable details. */
function matchReferenceIssues(flow: GuardFlow, catalog: SurfaceCatalog, data: RealizationMatch): MatchIssues {
  const issues = validateMatch(flow, catalog, data.plan).issues
  const byOrder = new Map(flow.milestones.map(m => [m.order, m]))
  const planned = new Set(data.plan.map(p => p.milestone))
  const seen = new Set<number>()
  const gapErrors: string[] = []
  for (const gap of data.gaps) {
    if (!byOrder.has(gap.milestone)) gapErrors.push(`gap names unknown milestone ${gap.milestone}`)
    if (planned.has(gap.milestone)) gapErrors.push(`milestone ${gap.milestone} appears in both plan and gaps; use one disposition`)
    if (seen.has(gap.milestone)) gapErrors.push(`milestone ${gap.milestone} has duplicate gaps; combine the reasons into one gap`)
    seen.add(gap.milestone)
  }
  return { ...issues, uncoveredMilestones: missingMilestones(flow, data), gapErrors }
}

/** Preserve independent assignments only after every action for their milestone validates.
 * An invalid action can be setup for a later valid action, so remove the entire
 * affected milestone instead of silently shortening its realization.
 */
function independentMatchPortions(flow: GuardFlow, catalog: SurfaceCatalog, data: RealizationMatch): RealizationMatch {
  const unsafe = new Set<number>()
  const planned = new Set(data.plan.map(entry => entry.milestone))
  const gapsSeen = new Set<number>()
  for (const gap of data.gaps) {
    if (planned.has(gap.milestone) || gapsSeen.has(gap.milestone)) unsafe.add(gap.milestone)
    gapsSeen.add(gap.milestone)
  }
  for (const [kind, entries] of [['plan', data.plan], ['gap', data.gaps]] as const) {
    for (const entry of entries) {
      const isolated = kind === 'plan' ? { plan: [entry as RealizationStep], gaps: [] }
        : { plan: [], gaps: [entry as RealizationGap] }
      const issues = matchReferenceIssues(flow, catalog, { ...isolated, unrealizable: undefined })
      if (issues.unknownInterfaces.length || issues.unknownMilestones.length || issues.gapErrors?.length) unsafe.add(entry.milestone)
    }
  }
  const safe = (entry: RealizationStep | RealizationGap) => !unsafe.has(entry.milestone)
  return { plan: data.plan.filter(safe), gaps: data.gaps.filter(safe), unrealizable: undefined }
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
): Promise<MatchOutcome> {
  cacheKey ??= matchCacheKey(flow, catalog)
  const base = buildContext(flow, catalog)
  const settle = (data: RealizationMatch, calls: number, repairMissing = false): MatchOutcome | null => {
    const gaps: RealizationGap[] = data.unrealizable
      ? flow.milestones.map(m => ({ milestone: m.order, kind: 'mapping', reason: data.unrealizable! }))
      : [...data.gaps]
    const combined = { ...data, gaps }
    if (repairMissing) for (const milestone of missingMilestones(flow, combined)) {
      const m = flow.milestones.find(m => m.order === milestone)!
      gaps.push({ milestone, kind: 'mapping', reason: `${uncoveredReason(flow, [milestone])}. Reconcile the interface catalog against ${m.doc} (claim ${m.claimId}); preserve the existing mapped actions.` })
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

  const cached = await getCacheEntryOrLegacy(repoRoot, MATCH_CACHE_NAME, cacheKey, ...matchLegacyCacheKeys(flow, catalog))
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
      ctx = { ...base, correction: { invalidOutput: `${flattenZodError(parsed.error)}\n${quoteInvalidOutput(raw)}\nPreserve valid portions for the milestones listed above. Use plan and gaps only; never combine them with unrealizable.` } }
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
        ? { plan: settled.plan.steps.map((s) => ({ interfaceId: s.interface.id, milestone: s.milestone, ...(s.note ? { note: s.note } : {}) })), gaps: settled.gaps }
        : settled.kind === 'gap' ? { gaps: settled.gaps } : null
      if (!data || settled.kind === 'error') return settled
      await setCacheEntry(repoRoot, MATCH_CACHE_NAME, cacheKey, data)
      await markContext()
      return settled
    }
    const partial = settle(independentMatchPortions(flow, catalog, parsed.data), calls, true)
    if (partial?.kind === 'plan') retained = partial
    const issues = matchReferenceIssues(flow, catalog, parsed.data)
    if (attempt > 0) return retainedWithError(describeMatchIssues(issues)) ?? { kind: 'error', reason: `match references invalid after re-ask: ${describeMatchIssues(issues)}; output: ${quoteInvalidOutput(raw)}`, calls }
    ctx = { ...base, issues,
      correction: { invalidOutput: quoteInvalidOutput(raw) } }
  }
  return { kind: 'error', reason: 'match exhausted its attempts', calls }
}

/** Stable ordered milestone/interface assignment shared by generation and cost estimation. */
export function realizationAssignmentFingerprint(plan: RealizationPlan): string {
  return createHash('sha256').update(JSON.stringify(plan.steps.map(s => [s.milestone, s.interface.id]))).digest('hex')
}

/** One realization must cover the entire immutable flow before authoring. */
export function completeRealization(flow: GuardFlow, plan: RealizationPlan): boolean {
  return flow.milestones.every(m => plan.steps.some(s => s.milestone === m.order))
}
