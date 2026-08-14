/**
 * Realization MATCHING (stage `guard.match`) — the join between the two halves of
 * guard. A flow says WHAT to test (spec-derived, code-blind); an interface catalog
 * says HOW the code can be driven (code-derived, spec-blind). One call per (flow,
 * surface) reads the flow's milestones and that surface's catalog DIGEST — ids,
 * entry descriptors, step summaries; never code — and returns either an ordered
 * realization plan (which interface walks which milestone) or an explicit
 * `unrealizable` reason.
 *
 * Both failure shapes are GAPS, never findings, and they are deliberately
 * un-conflated because their remedies are opposite:
 *  - an EMPTY catalog for the surface never reaches the model at all — the caller
 *    settles it as `no-interface` ("the mapper can't see this surface");
 *  - a matcher refusal (or a plan that still misses a milestone after the one
 *    corrective re-ask) settles as `unrealizable` ("the spec promises this; no code
 *    surface offers it").
 *
 * Every interface id the model returns is validated against the catalog and every
 * milestone against the flow — a plan is never trusted to name something real.
 * The cache lives under `.cache/guard/match` (derived, deletable), keyed on the
 * flow fingerprint + the surface's catalog fingerprint + the prompt fingerprint +
 * the format version, so an unchanged flow on an unchanged surface costs nothing.
 * {@link planFlowMatching} is the ONE planner the runtime and the pre-flight
 * estimate share, so the estimate probes exactly the cache the run reads.
 */

import { createHash } from 'node:crypto'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import {
  interfaceEntryLabel,
  interfaceFingerprint,
  type GuardDriverId,
  type GuardFlow,
  type Interface,
  type InterfaceStep,
} from '@truecourse/shared'
import { RealizationMatchSchema, type RealizationStep } from './schemas.js'
import {
  MATCH_PROMPT_FINGERPRINT,
  type InterfaceDigest,
  type MatchIssues,
  type MatchUserContext,
} from './prompts.js'
import { flattenZodError, quoteInvalidOutput } from './validate.js'
import type { MatchRunner } from './runners.js'

export const MATCH_CACHE_NAME = 'guard/match'

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

/** One surface's interfaces plus the fingerprint over that set (the cache key half). */
export interface SurfaceCatalog {
  surface: GuardDriverId
  interfaces: Interface[]
  /** `sha256:…` over the surface's sorted interface fingerprints. */
  fingerprint: string
}

/**
 * Group an interface catalog by surface (an interface's `type` IS the driver that would
 * run its scenarios) and fingerprint each group over its interfaces' own
 * fingerprints, sorted — so the value depends on the SET of surfaces a user can
 * reach, never on derivation order.
 */
export function buildSurfaceCatalogs(interfaces: readonly Interface[]): Map<GuardDriverId, SurfaceCatalog> {
  const byType = new Map<GuardDriverId, Interface[]>()
  for (const iface of interfaces) {
    const list = byType.get(iface.type)
    if (list) list.push(iface)
    else byType.set(iface.type, [iface])
  }
  const out = new Map<GuardDriverId, SurfaceCatalog>()
  for (const [surface, list] of byType) {
    const body = list
      .map((j) => j.fingerprint || interfaceFingerprint(j))
      .sort()
      .join('\n')
    out.set(surface, {
      surface,
      interfaces: list,
      fingerprint: `sha256:${createHash('sha256').update(body, 'utf-8').digest('hex')}`,
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
    default:
      return `${step.kind}: ${step.target}`
  }
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
      return `fill: ${step.target}`
    default:
      return `click: ${step.target}`
  }
}

// ---------------------------------------------------------------------------
// Cache key + planning (shared by the runtime and the pre-flight estimate)
// ---------------------------------------------------------------------------

/**
 * A (flow, surface) match's content key: the flow's milestone composition, the
 * surface's catalog fingerprint, the matching prompt, and the format version.
 * Editing a doc that moves the flow's fingerprint, or a code change that moves the
 * surface, re-matches; nothing else does.
 */
export function matchCacheKey(
  flow: Pick<GuardFlow, 'fingerprint'>,
  catalog: Pick<SurfaceCatalog, 'surface' | 'fingerprint'>,
): string {
  return createHash('sha256')
    .update(
      [
        MATCH_PROMPT_FINGERPRINT,
        catalog.surface,
        catalog.fingerprint,
        flow.fingerprint,
      ].join('::'),
    )
    .digest('hex')
}

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
  cacheKey = matchCacheKey(flow, catalog),
): Promise<{ plan: RealizationPlan | null; unrealizable?: string } | null> {
  const cached = await getCacheEntry(repoRoot, MATCH_CACHE_NAME, cacheKey)
  if (!cached) return null
  const parsed = RealizationMatchSchema.safeParse(cached)
  if (!parsed.success) return null
  if (parsed.data.unrealizable) return { plan: null, unrealizable: parsed.data.unrealizable }
  const v = validateMatch(flow, catalog, parsed.data.plan)
  if (hasIssues(v.issues)) return null
  return { plan: { surface: catalog.surface, steps: v.steps, interfaces: pathOf(v.steps) } }
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

/** A flow's realization on ONE surface — the plan the authoring call is given. */
export interface RealizationPlan {
  surface: GuardDriverId
  /** The plan entries in the model's order, validated against flow + catalog. */
  steps: { interface: Interface; milestone: number; note?: string }[]
  /** The distinct interfaces the plan walks, in first-use order — the scenario's `interface.path`. */
  interfaces: Interface[]
}

/** A flow's verdict on one surface: a plan, a stated refusal, or a stage failure. */
export type MatchOutcome =
  | { kind: 'plan'; plan: RealizationPlan; calls: number }
  | { kind: 'unrealizable'; reason: string; calls: number }
  | { kind: 'error'; reason: string; calls: number }

/** Validation of one raw match reply against the flow and the surface's catalog. */
interface MatchValidation {
  steps: { interface: Interface; milestone: number; note?: string }[]
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
  const steps: { interface: Interface; milestone: number; note?: string }[] = []
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

function hasIssues(issues: MatchIssues): boolean {
  return (
    issues.unknownInterfaces.length > 0 ||
    issues.unknownMilestones.length > 0 ||
    issues.uncoveredMilestones.length > 0
  )
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

/** The engine's own `unrealizable` reason when a validated plan still misses milestones. */
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
  cacheKey = matchCacheKey(flow, catalog),
): Promise<MatchOutcome> {
  const base = buildContext(flow, catalog)

  const settle = (data: { plan: RealizationStep[]; unrealizable?: string }): MatchOutcome | null => {
    if (data.unrealizable) return { kind: 'unrealizable', reason: data.unrealizable, calls: 0 }
    const v = validateMatch(flow, catalog, data.plan)
    if (hasIssues(v.issues)) return null
    return {
      kind: 'plan',
      plan: { surface: catalog.surface, steps: v.steps, interfaces: pathOf(v.steps) },
      calls: 0,
    }
  }

  const cached = await getCacheEntry(repoRoot, MATCH_CACHE_NAME, cacheKey)
  if (cached) {
    const parsed = RealizationMatchSchema.safeParse(cached)
    if (parsed.success) {
      // A cached verdict was validated before it was written, so this re-check is a
      // formality — but it keeps a hand-edited cache file from producing a plan the
      // engine would never have accepted.
      const settled = settle(parsed.data)
      if (settled) return settled
    }
  }

  let calls = 0
  let ctx: MatchUserContext = base
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown
    try {
      calls++
      raw = await runner(ctx)
    } catch (e) {
      return { kind: 'error', reason: `match call failed: ${(e as Error).message}`, calls }
    }
    const parsed = RealizationMatchSchema.safeParse(raw)
    if (!parsed.success) {
      if (attempt > 0) return { kind: 'error', reason: `match output invalid after re-ask: ${flattenZodError(parsed.error)}`, calls }
      ctx = { ...base, correction: { invalidOutput: quoteInvalidOutput(raw) } }
      continue
    }
    if (parsed.data.unrealizable) {
      await setCacheEntry(repoRoot, MATCH_CACHE_NAME, cacheKey, parsed.data)
      return { kind: 'unrealizable', reason: parsed.data.unrealizable, calls }
    }
    const v = validateMatch(flow, catalog, parsed.data.plan)
    if (hasIssues(v.issues)) {
      if (attempt > 0) {
        // The model had its correction and still cannot walk the whole path. That IS
        // the honest verdict: uncovered milestones read as unrealizable (the signal),
        // while an answer that keeps naming interfaces the catalog doesn't have is a
        // stage failure, not a statement about the product.
        if (v.issues.uncoveredMilestones.length > 0 && v.issues.unknownInterfaces.length === 0) {
          return { kind: 'unrealizable', reason: uncoveredReason(flow, v.issues.uncoveredMilestones), calls }
        }
        return {
          kind: 'error',
          reason: `match named ${v.issues.unknownInterfaces.length} interface id(s) outside the catalog after re-ask (${v.issues.unknownInterfaces[0]})`,
          calls,
        }
      }
      ctx = { ...base, issues: v.issues }
      continue
    }
    await setCacheEntry(repoRoot, MATCH_CACHE_NAME, cacheKey, parsed.data)
    return {
      kind: 'plan',
      plan: { surface: catalog.surface, steps: v.steps, interfaces: pathOf(v.steps) },
      calls,
    }
  }
  return { kind: 'error', reason: 'match exhausted its attempts', calls }
}
