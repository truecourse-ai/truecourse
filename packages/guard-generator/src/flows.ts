/**
 * Flow SYNTHESIS (stage `guard.flows`) — the spec-side generation unit. One LLM
 * call per AREA composes that area's already-extracted claims into user-goal
 * paths (flows); a second call chains the results into cross-area epics. The
 * output is `.truecourse/scenarios/flows.json`, the committable flow corpus
 * scenarios reference by id.
 *
 * THE INDEPENDENCE INVARIANT: synthesis sees ONLY spec-derived text — claims,
 * their sections, and heading outlines. No code, no probe transcripts, no recipe,
 * no journey catalog ever enters these prompts. Flow-vs-journey independence is
 * what makes an unrealizable milestone a real signal instead of a tautology.
 *
 * The model may only ORDER and GROUP claims: every milestone is SNAPPED back onto
 * the area's claim inventory (unknown references are rejected), and every runnable
 * claim must land in a flow or carry a stated no-flow reason. Both failures earn
 * exactly ONE corrective re-ask; an area that still fails stays UNSETTLED (no
 * flows, nothing cached, reported) rather than emitting invented paths.
 *
 * Caches are content-keyed under `.cache/guard/flows` (derived, deletable): an
 * area keys on its claim set + outlines + the prompt fingerprint, the epic pass on
 * the flow digests + its prompt fingerprint. {@link planFlowSynthesis} is the ONE
 * planner both the runtime and the pre-flight estimate use, so the estimate probes
 * exactly the cache the run reads.
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import { atomicWriteJson, scenariosDir, slugifyHeading } from '@truecourse/guard-runner'
import {
  GuardFlowsFileSchema,
  flowFingerprint,
  flowMilestoneKey,
  resolveFlowIdentity,
  isRunnableDriver,
  type GuardDriverId,
  type GuardFlow,
  type GuardFlowBinding,
  type GuardFlowMilestone,
  type GuardFlowsFile,
  type GuardNoFlowClaim,
} from '@truecourse/shared'
import {
  FlowSynthesisSchema,
  EpicSynthesisSchema,
  type FlowSynthesis,
  type SynthesizedMilestone,
} from './schemas.js'
import {
  FLOWS_PROMPT_FINGERPRINT,
  FLOWS_EPIC_PROMPT_FINGERPRINT,
  type FlowClaimLine,
  type FlowDigest,
  type FlowsUserContext,
  type FlowsEpicUserContext,
  type OutlineEntry,
} from './prompts.js'
import { flattenZodError, quoteInvalidOutput } from './validate.js'
import type { ConcurrencyLimit } from './extract.js'
import type { FlowsRunner, FlowsEpicRunner } from './runners.js'

export const FLOWS_CACHE_NAME = 'guard/flows'

/** The committed flow corpus — next to `manifest.json`, same commit story. */
export function flowsPath(repoRoot: string): string {
  return path.join(scenariosDir(repoRoot), 'flows.json')
}

/** Read the committed flows file, or `null` when absent/unparseable. */
export function readFlowsFile(repoRoot: string): GuardFlowsFile | null {
  const file = flowsPath(repoRoot)
  if (!fs.existsSync(file)) return null
  try {
    const parsed = GuardFlowsFileSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One extracted claim as synthesis consumes it. The caller has already dropped
 *  dismissed claims — synthesis never re-reads decisions. */
export interface FlowClaimInput {
  /** Repo-relative doc path the claim was extracted from. */
  doc: string
  /** The live section anchor the claim is bound to. */
  anchor: string
  /** The claim's text — becomes a milestone's `claimTitle` verbatim. */
  title: string
  /** The surface hint extraction assigned; runnable surfaces must be accounted for. */
  driver: GuardDriverId
}

/** One document's synthesis context: its outline and its untestable sections. */
export interface FlowDocInput {
  doc: string
  outline: OutlineEntry[]
  untestable?: { anchor: string; reason: string }[]
}

/** One area's synthesis unit — the claims one LLM call composes. */
export interface FlowSynthesisArea {
  areaId: string
  claims: FlowClaimInput[]
  docs: FlowDocInput[]
}

/** A document with its extraction, ready to be grouped into areas. */
export interface FlowAreaDocInput extends FlowDocInput {
  /** Canonical area ids from the corpus (empty for an untagged doc). */
  areaTags: string[]
  claims: FlowClaimInput[]
}

/** `doc` + `anchor` key for the section-fingerprint lookup bindings resolve through. */
export function flowSectionKey(doc: string, anchor: string): string {
  return `${doc}\0${anchor}`
}

/**
 * A document's AREA — its first corpus area tag, or a per-document area when the
 * corpus tags it with none. One rule, used by the runtime and the estimate alike,
 * so a doc's claims are synthesized exactly once: areas partition the claim
 * inventory, which is what makes the coverage honesty rule well-defined.
 */
export function flowAreaIdForDoc(doc: string, areaTags: readonly string[]): string {
  return areaTags[0] ?? `doc:${doc}`
}

/** Group per-document extractions into the areas synthesis calls on, in stable
 *  (area id) order with each area's docs in the order they were given. */
export function buildFlowAreas(docs: readonly FlowAreaDocInput[]): FlowSynthesisArea[] {
  const byArea = new Map<string, FlowSynthesisArea>()
  for (const d of docs) {
    const areaId = flowAreaIdForDoc(d.doc, d.areaTags)
    let area = byArea.get(areaId)
    if (!area) {
      area = { areaId, claims: [], docs: [] }
      byArea.set(areaId, area)
    }
    area.docs.push({ doc: d.doc, outline: d.outline, untestable: d.untestable })
    area.claims.push(...d.claims)
  }
  return [...byArea.values()].sort((a, b) => a.areaId.localeCompare(b.areaId))
}

// ---------------------------------------------------------------------------
// Cache keys + planning (shared by the runtime and the pre-flight estimate)
// ---------------------------------------------------------------------------

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * An area's content key: its claim set (identity + surface, order-independent)
 * plus its documents' outlines, under the synthesis prompt's fingerprint. Adding,
 * removing, or editing a claim re-synthesizes the area; re-running with the same
 * inventory is a cache hit and costs nothing.
 */
export function flowAreaCacheKey(area: FlowSynthesisArea): string {
  const claims = area.claims
    .map((c) => `${c.doc}\0${normalizeText(c.anchor)}\0${normalizeText(c.title)}\0${c.driver}`)
    .sort()
    .join('\n')
  const outlines = area.docs
    .map((d) => {
      const sections = d.outline.map((e) => `${e.anchor}\0${normalizeText(e.headingText)}\0${e.level}`).join('\n')
      const untestable = (d.untestable ?? []).map((u) => `${u.anchor}\0${normalizeText(u.reason)}`).sort().join('\n')
      return `${d.doc}\n${sections}\n${untestable}`
    })
    .sort()
    .join('\n--\n')
  return sha(`${FLOWS_PROMPT_FINGERPRINT}::${area.areaId}::${sha(claims)}::${sha(outlines)}`)
}

/** The epic pass's content key: the flow digests it reads, under its own prompt
 *  fingerprint. Unchanged flows ⇒ no epic call. */
export function flowEpicCacheKey(digests: readonly FlowDigest[]): string {
  const body = digests
    .map((d) => [d.areaId, d.title, d.goal, ...d.milestones.map((m) => `${m.doc}\0${m.anchor}\0${normalizeText(m.claimTitle)}`)].join('\n'))
    .join('\n--\n')
  return sha(`${FLOWS_EPIC_PROMPT_FINGERPRINT}::${sha(body)}`)
}

/** One area's planned synthesis work — the estimate and the run read the same row. */
export interface FlowAreaPlan {
  areaId: string
  cacheKey: string
  /** True when this area's synthesis is already cached (zero LLM calls). */
  cached: boolean
  claims: number
  /** Claims on runnable surfaces — the coverage-accounted subset. */
  runnableClaims: number
}

/** The synthesis stage's planned work: exact per-area calls plus the epic ceiling. */
export interface FlowSynthesisPlan {
  areas: FlowAreaPlan[]
  /** Exact number of per-area synthesis calls a run will make (cache misses). */
  areaCalls: number
  /** Ceiling on epic-pass calls (1 when >1 area can yield flows, else 0). */
  epicCalls: number
  /**
   * The honest upper bound on synthesized flows: milestones partition claims in
   * the worst case, so a run can never produce more flows than it has runnable
   * claims. Flow COUNT is a synthesis output — unknowable before the call — and
   * this bound is what the pre-flight estimate quotes instead of guessing.
   */
  maxFlows: number
}

/**
 * Plan the synthesis stage against the real cache. The ONE planner: the runtime
 * calls it to decide which areas need an LLM call, and the pre-flight estimate
 * calls it to count them — so an estimate can never promise work the run skips
 * (or hide work it pays for).
 */
export async function planFlowSynthesis(
  repoRoot: string,
  areas: readonly FlowSynthesisArea[],
): Promise<FlowSynthesisPlan> {
  const rows: FlowAreaPlan[] = []
  for (const area of areas) {
    const cacheKey = flowAreaCacheKey(area)
    rows.push({
      areaId: area.areaId,
      cacheKey,
      cached: (await getCacheEntry(repoRoot, FLOWS_CACHE_NAME, cacheKey)) !== null,
      claims: area.claims.length,
      runnableClaims: area.claims.filter((c) => isRunnableDriver(c.driver)).length,
    })
  }
  const areasWithClaims = rows.filter((r) => r.claims > 0).length
  return {
    areas: rows,
    areaCalls: rows.filter((r) => !r.cached).length,
    epicCalls: areasWithClaims > 1 ? 1 : 0,
    maxFlows: rows.reduce((n, r) => n + r.runnableClaims, 0),
  }
}

// ---------------------------------------------------------------------------
// Claim inventory + milestone snapping
// ---------------------------------------------------------------------------

/** A claim's identity key — doc + anchor + normalized text (case-insensitive). */
function claimKey(doc: string, anchor: string, title: string): string {
  return `${doc}\0${normalizeText(anchor)}\0${normalizeText(title).toLowerCase()}`
}

/** A looser form for snapping: markup and trailing punctuation folded away. */
function looseTitle(title: string): string {
  return normalizeText(title)
    .toLowerCase()
    .replace(/[`"'*_]/g, '')
    .replace(/[.;:,!]+$/, '')
}

/** Shortest text length a containment match is allowed to snap on. */
const MIN_CONTAINMENT_CHARS = 12

interface ClaimIndex {
  byKey: Map<string, FlowClaimInput>
  byDocAnchor: Map<string, FlowClaimInput[]>
  byDocLoose: Map<string, FlowClaimInput[]>
  all: FlowClaimInput[]
}

function buildClaimIndex(claims: readonly FlowClaimInput[]): ClaimIndex {
  const index: ClaimIndex = { byKey: new Map(), byDocAnchor: new Map(), byDocLoose: new Map(), all: [...claims] }
  for (const c of claims) {
    index.byKey.set(claimKey(c.doc, c.anchor, c.title), c)
    const da = flowSectionKey(c.doc, c.anchor)
    const list = index.byDocAnchor.get(da)
    if (list) list.push(c)
    else index.byDocAnchor.set(da, [c])
    const dl = `${c.doc}\0${looseTitle(c.title)}`
    const ll = index.byDocLoose.get(dl)
    if (ll) ll.push(c)
    else index.byDocLoose.set(dl, [c])
  }
  return index
}

/**
 * Snap a model-returned claim reference onto the inventory, or reject it.
 * Precedence, tightest first: the exact identity triple; a unique loose-text match
 * inside the named section; a unique containment match inside the named section
 * (the model paraphrased or truncated); a unique loose-text match elsewhere in the
 * same document (the anchor was wrong). Anything else is REJECTED — a milestone is
 * never bound to a claim the model might not have meant.
 */
function snapClaim(ref: { doc: string; anchor: string; claimTitle: string }, index: ClaimIndex): FlowClaimInput | null {
  const exact = index.byKey.get(claimKey(ref.doc, ref.anchor, ref.claimTitle))
  if (exact) return exact

  const loose = looseTitle(ref.claimTitle)
  const inSection = index.byDocAnchor.get(flowSectionKey(ref.doc, ref.anchor)) ?? []
  const looseHits = inSection.filter((c) => looseTitle(c.title) === loose)
  if (looseHits.length === 1) return looseHits[0]
  if (loose.length >= MIN_CONTAINMENT_CHARS) {
    const contained = inSection.filter((c) => {
      const t = looseTitle(c.title)
      return t.includes(loose) || loose.includes(t)
    })
    if (contained.length === 1) return contained[0]
  }
  const byDoc = index.byDocLoose.get(`${ref.doc}\0${loose}`) ?? []
  if (byDoc.length === 1) return byDoc[0]
  return null
}

/** How a rejected reference is quoted back to the model on the re-ask. */
function describeRef(ref: { doc: string; anchor: string; claimTitle: string }): string {
  return `${ref.doc}#${ref.anchor} — "${normalizeText(ref.claimTitle)}"`
}

function describeClaim(claim: FlowClaimInput): string {
  return `${claim.doc}#${claim.anchor} — "${normalizeText(claim.title)}"`
}

// ---------------------------------------------------------------------------
// Draft flows (pre-identity)
// ---------------------------------------------------------------------------

/** A flow before identity resolution: composed, validated, not yet id'd. */
interface DraftFlow {
  areaId: string
  title: string
  goal: string
  milestones: GuardFlowMilestone[]
  /** Digest refs of the chained flows (epics only) — rewritten to ids at the end. */
  composedRefs: string[]
  synthesisInputsHash: string
}

/** Order the model's milestones (explicit `order` when complete, else the array's
 *  order), drop repeats of the same claim, and renumber the path 1..n. */
function orderMilestones(raw: { milestone: SynthesizedMilestone; claim: FlowClaimInput }[]): GuardFlowMilestone[] {
  const indexed = raw.map((entry, i) => ({ ...entry, i }))
  if (indexed.every((e) => typeof e.milestone.order === 'number')) {
    indexed.sort((a, b) => (a.milestone.order! - b.milestone.order!) || a.i - b.i)
  }
  const seen = new Set<string>()
  const milestones: GuardFlowMilestone[] = []
  for (const e of indexed) {
    const key = flowMilestoneKey({ anchor: e.claim.anchor, claimTitle: e.claim.title })
    if (seen.has(key)) continue
    seen.add(key)
    milestones.push({
      order: milestones.length + 1,
      doc: e.claim.doc,
      anchor: e.claim.anchor,
      claimTitle: e.claim.title,
      ...(e.milestone.note ? { note: e.milestone.note } : {}),
    })
  }
  return milestones
}

interface AreaValidation {
  flows: DraftFlow[]
  noFlowClaims: GuardNoFlowClaim[]
  unknownReferences: string[]
  uncoveredClaims: string[]
}

/** Snap one area's synthesis output and check the coverage honesty rule. */
function validateAreaSynthesis(
  area: FlowSynthesisArea,
  data: FlowSynthesis,
  index: ClaimIndex,
  synthesisInputsHash: string,
): AreaValidation {
  const unknownReferences: string[] = []
  const covered = new Set<string>()
  const flows: DraftFlow[] = []

  for (const flow of data.flows) {
    const snapped: { milestone: SynthesizedMilestone; claim: FlowClaimInput }[] = []
    for (const milestone of flow.milestones) {
      const claim = snapClaim(milestone, index)
      if (!claim) {
        unknownReferences.push(describeRef(milestone))
        continue
      }
      snapped.push({ milestone, claim })
    }
    const milestones = orderMilestones(snapped)
    if (milestones.length === 0) continue
    for (const m of milestones) covered.add(claimKey(m.doc, m.anchor, m.claimTitle))
    flows.push({
      areaId: area.areaId,
      title: normalizeText(flow.title),
      goal: normalizeText(flow.goal),
      milestones,
      composedRefs: [],
      synthesisInputsHash,
    })
  }

  const noFlowClaims: GuardNoFlowClaim[] = []
  const seenNoFlow = new Set<string>()
  for (const entry of data.noFlowClaims) {
    const claim = snapClaim(entry, index)
    if (!claim) {
      unknownReferences.push(describeRef(entry))
      continue
    }
    const key = claimKey(claim.doc, claim.anchor, claim.title)
    covered.add(key)
    if (seenNoFlow.has(key)) continue
    seenNoFlow.add(key)
    noFlowClaims.push({ doc: claim.doc, anchor: claim.anchor, claimTitle: claim.title, reason: normalizeText(entry.reason) })
  }

  const uncoveredClaims = index.all
    .filter((c) => isRunnableDriver(c.driver) && !covered.has(claimKey(c.doc, c.anchor, c.title)))
    .map(describeClaim)

  return { flows, noFlowClaims, unknownReferences, uncoveredClaims }
}

// ---------------------------------------------------------------------------
// Per-area synthesis (cache → call → one corrective re-ask)
// ---------------------------------------------------------------------------

type AreaOutcome =
  | { ok: true; flows: DraftFlow[]; noFlowClaims: GuardNoFlowClaim[]; calls: number }
  | { ok: false; reason: string; calls: number }

function claimLines(area: FlowSynthesisArea): FlowClaimLine[] {
  return area.claims.map((c) => ({
    doc: c.doc,
    anchor: c.anchor,
    claim: c.title,
    driver: c.driver,
    required: isRunnableDriver(c.driver),
  }))
}

async function synthesizeArea(
  repoRoot: string,
  area: FlowSynthesisArea,
  plan: FlowAreaPlan,
  runner: FlowsRunner,
): Promise<AreaOutcome> {
  const index = buildClaimIndex(area.claims)
  const base: FlowsUserContext = { areaId: area.areaId, claims: claimLines(area), docs: area.docs }

  const cached = await getCacheEntry(repoRoot, FLOWS_CACHE_NAME, plan.cacheKey)
  if (cached) {
    const parsed = FlowSynthesisSchema.safeParse(cached)
    if (parsed.success) {
      const v = validateAreaSynthesis(area, parsed.data, index, plan.cacheKey)
      // A cached entry was validated before it was written, so this re-check is a
      // formality — but it keeps a hand-edited or half-written cache file from
      // producing flows the engine would never have accepted.
      if (v.unknownReferences.length === 0 && v.uncoveredClaims.length === 0) {
        return { ok: true, flows: v.flows, noFlowClaims: v.noFlowClaims, calls: 0 }
      }
    }
  }

  let calls = 0
  let ctx: FlowsUserContext = base
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown
    try {
      calls++
      raw = await runner(ctx)
    } catch (e) {
      return { ok: false, reason: `flow synthesis call failed: ${(e as Error).message}`, calls }
    }
    const parsed = FlowSynthesisSchema.safeParse(raw)
    if (!parsed.success) {
      if (attempt > 0) return { ok: false, reason: `flow synthesis invalid after re-ask: ${flattenZodError(parsed.error)}`, calls }
      ctx = { ...base, correction: { invalidOutput: quoteInvalidOutput(raw) } }
      continue
    }
    const v = validateAreaSynthesis(area, parsed.data, index, plan.cacheKey)
    if (v.unknownReferences.length > 0 || v.uncoveredClaims.length > 0) {
      if (attempt > 0) {
        const parts: string[] = []
        if (v.unknownReferences.length > 0) parts.push(`${v.unknownReferences.length} milestone(s) matched no claim (${v.unknownReferences[0]})`)
        if (v.uncoveredClaims.length > 0) parts.push(`${v.uncoveredClaims.length} claim(s) left unaccounted (${v.uncoveredClaims[0]})`)
        return { ok: false, reason: `flow synthesis unsettled after re-ask: ${parts.join('; ')}`, calls }
      }
      ctx = { ...base, issues: { unknownReferences: v.unknownReferences, uncoveredClaims: v.uncoveredClaims } }
      continue
    }
    await setCacheEntry(repoRoot, FLOWS_CACHE_NAME, plan.cacheKey, parsed.data)
    return { ok: true, flows: v.flows, noFlowClaims: v.noFlowClaims, calls }
  }
  return { ok: false, reason: 'flow synthesis exhausted its attempts', calls }
}

// ---------------------------------------------------------------------------
// Epic pass
// ---------------------------------------------------------------------------

function digestsOf(flows: readonly DraftFlow[]): FlowDigest[] {
  return flows.map((f, i) => ({
    ref: `F${i + 1}`,
    areaId: f.areaId,
    title: f.title,
    goal: f.goal,
    milestones: f.milestones.map((m) => ({ doc: m.doc, anchor: m.anchor, claimTitle: m.claimTitle })),
  }))
}

type EpicOutcome = { epics: DraftFlow[]; calls: number; error?: string }

/**
 * One call over the flow DIGESTS (never the documents again). Epics may only chain
 * flows the per-area pass produced, and may only reuse THOSE flows' milestones — so
 * an epic can never introduce a claim no flow covers.
 */
async function synthesizeEpics(
  repoRoot: string,
  flows: readonly DraftFlow[],
  index: ClaimIndex,
  runner: FlowsEpicRunner,
): Promise<EpicOutcome> {
  const digests = digestsOf(flows)
  const cacheKey = flowEpicCacheKey(digests)
  const byRef = new Map(digests.map((d, i) => [d.ref, i]))
  const base: FlowsEpicUserContext = { digests }

  const build = (data: { epics: { title: string; goal: string; composedOf: string[]; milestones: SynthesizedMilestone[] }[] }) => {
    const unknownReferences: string[] = []
    const epics: DraftFlow[] = []
    for (const epic of data.epics) {
      const refs: string[] = []
      for (const ref of epic.composedOf) {
        const normalized = ref.trim().toUpperCase()
        if (!byRef.has(normalized)) {
          unknownReferences.push(`composedOf: ${ref}`)
          continue
        }
        if (!refs.includes(normalized)) refs.push(normalized)
      }
      if (refs.length < 2) {
        if (epic.composedOf.length >= 2) unknownReferences.push(`"${normalizeText(epic.title)}" chains fewer than two known flows`)
        continue
      }
      // The milestone vocabulary of an epic is exactly its composed flows' milestones.
      const allowed = new Set<string>()
      for (const r of refs) {
        for (const m of flows[byRef.get(r)!].milestones) allowed.add(claimKey(m.doc, m.anchor, m.claimTitle))
      }
      const snapped: { milestone: SynthesizedMilestone; claim: FlowClaimInput }[] = []
      for (const milestone of epic.milestones) {
        const claim = snapClaim(milestone, index)
        if (!claim || !allowed.has(claimKey(claim.doc, claim.anchor, claim.title))) {
          unknownReferences.push(describeRef(milestone))
          continue
        }
        snapped.push({ milestone, claim })
      }
      const milestones = orderMilestones(snapped)
      if (milestones.length < 2) continue
      epics.push({
        areaId: '(epic)',
        title: normalizeText(epic.title),
        goal: normalizeText(epic.goal),
        milestones,
        composedRefs: refs,
        synthesisInputsHash: cacheKey,
      })
    }
    return { epics, unknownReferences }
  }

  const cached = await getCacheEntry(repoRoot, FLOWS_CACHE_NAME, cacheKey)
  if (cached) {
    const parsed = EpicSynthesisSchema.safeParse(cached)
    if (parsed.success) {
      const built = build(parsed.data)
      if (built.unknownReferences.length === 0) return { epics: built.epics, calls: 0 }
    }
  }

  let calls = 0
  let ctx: FlowsEpicUserContext = base
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown
    try {
      calls++
      raw = await runner(ctx)
    } catch (e) {
      return { epics: [], calls, error: `epic pass call failed: ${(e as Error).message}` }
    }
    const parsed = EpicSynthesisSchema.safeParse(raw)
    if (!parsed.success) {
      if (attempt > 0) return { epics: [], calls, error: `epic pass invalid after re-ask: ${flattenZodError(parsed.error)}` }
      ctx = { ...base, correction: { invalidOutput: quoteInvalidOutput(raw) } }
      continue
    }
    const built = build(parsed.data)
    if (built.unknownReferences.length > 0) {
      if (attempt > 0) {
        return { epics: [], calls, error: `epic pass unsettled after re-ask: ${built.unknownReferences[0]}` }
      }
      ctx = { ...base, issues: { unknownReferences: built.unknownReferences } }
      continue
    }
    await setCacheEntry(repoRoot, FLOWS_CACHE_NAME, cacheKey, parsed.data)
    return { epics: built.epics, calls }
  }
  return { epics: [], calls, error: 'epic pass exhausted its attempts' }
}

// ---------------------------------------------------------------------------
// Deterministic subsumption post-pass
// ---------------------------------------------------------------------------

/** A flow dropped because a sibling already walks its whole path. */
export interface SubsumedFlow {
  title: string
  supersededBy: string
}

function milestoneSequence(flow: DraftFlow): string[] {
  return flow.milestones.map((m) => flowMilestoneKey({ anchor: m.anchor, claimTitle: m.claimTitle }))
}

/** Whether `inner` appears in `outer` as a CONTIGUOUS run (order preserved). */
function containsContiguous(outer: readonly string[], inner: readonly string[]): boolean {
  if (inner.length > outer.length) return false
  for (let start = 0; start + inner.length <= outer.length; start++) {
    let hit = true
    for (let k = 0; k < inner.length; k++) {
      if (outer[start + k] !== inner[k]) {
        hit = false
        break
      }
    }
    if (hit) return true
  }
  return false
}

/**
 * Drop near-duplicates deterministically: a flow whose milestone sequence is a
 * CONTIGUOUS subsequence of a sibling's is redundant — the longer path already
 * walks it. Two exceptions keep the pass safe:
 *  - identical sequences: the FIRST one survives (never drop both);
 *  - a flow is kept when dropping it would leave one of its bound sections with no
 *    flow at all — coverage is never traded for tidiness.
 * Candidates are examined shortest-first, so the survivor is always the longest
 * path of a chain. The caller runs this per TIER (area flows, then epics): an epic
 * is a superset of the flows it composes by construction, and must never delete them.
 */
function applySubsumption(flows: readonly DraftFlow[]): { kept: DraftFlow[]; dropped: SubsumedFlow[] } {
  const sequences = flows.map(milestoneSequence)
  const dropped = new Map<number, SubsumedFlow>()
  const order = flows.map((_, i) => i).sort((a, b) => sequences[a].length - sequences[b].length || a - b)

  const sectionsOf = (i: number) => new Set(flows[i].milestones.map((m) => flowSectionKey(m.doc, m.anchor)))

  for (const i of order) {
    if (dropped.has(i)) continue
    for (let j = 0; j < flows.length; j++) {
      if (j === i || dropped.has(j)) continue
      if (sequences[j].length < sequences[i].length) continue
      // Equal-length pairs are duplicates: only the EARLIER one may subsume.
      if (sequences[j].length === sequences[i].length && j > i) continue
      if (!containsContiguous(sequences[j], sequences[i])) continue
      // Coverage gate: every section this flow binds must survive without it.
      const sections = sectionsOf(i)
      const stillCovered = [...sections].every((section) =>
        flows.some((_, k) => k !== i && !dropped.has(k) && sectionsOf(k).has(section)),
      )
      if (!stillCovered) continue
      dropped.set(i, { title: flows[i].title, supersededBy: flows[j].title })
      break
    }
  }

  return { kept: flows.filter((_, i) => !dropped.has(i)), dropped: [...dropped.values()] }
}

// ---------------------------------------------------------------------------
// Identity + ids
// ---------------------------------------------------------------------------

/**
 * Longest slug an id is trimmed to (at a word boundary) — ids are handles, and
 * `<flow-id>.<surface>.<n>.yaml` has to fit a 255-byte filename (a flow title can
 * be a whole sentence; an uncapped stem crashes the scenario write).
 */
const MAX_SLUG_CHARS = 60

/**
 * The id stem for a flow title. A trimmed slug carries an 8-hex hash of the FULL
 * slug: two long titles that differ only past the cut would otherwise collapse to
 * one stem and be told apart by `freeId`'s `-N`, which is assigned in synthesis
 * ORDER — so a re-synthesis that ordered them differently would swap their ids and
 * churn every scenario file they own. With the hash the stem is a function of the
 * title alone: distinct, deterministic, order-free. Short titles are untouched.
 */
function slugForTitle(title: string): string {
  const slug = slugifyHeading(title) || 'flow'
  if (slug.length <= MAX_SLUG_CHARS) return slug
  const cut = slug.slice(0, MAX_SLUG_CHARS)
  const boundary = cut.lastIndexOf('-')
  const stem = (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/, '')
  return `${stem}-${createHash('sha256').update(slug).digest('hex').slice(0, 8)}`
}

/** Take `base`, or the first free `base-N` — the `-N` disambiguation rule. */
function freeId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

// ---------------------------------------------------------------------------
// synthesizeFlows
// ---------------------------------------------------------------------------

export interface SynthesizeFlowsOptions {
  repoRoot: string
  /** The areas to synthesize — every area whose claim inventory the run knows. */
  areas: readonly FlowSynthesisArea[]
  /** Per-area synthesis seam (`guard.flows`). */
  runner: FlowsRunner
  /** Cross-area epic seam. Omit to skip the epic pass entirely. */
  epicRunner?: FlowsEpicRunner
  /** `doc`+`anchor` ({@link flowSectionKey}) → the section's live fingerprint. */
  sectionFingerprints: ReadonlyMap<string, string>
  /** The committed flows identity resolves against; defaults to `flows.json`. */
  previous?: readonly GuardFlow[]
  /** False to compute without writing `flows.json` (callers that stage the write). */
  write?: boolean
  /** Shared concurrency limit for the per-area calls. */
  limit?: ConcurrencyLimit
  /** Progress hook, fired once per area as it settles. */
  onArea?: (areaId: string) => void
  /** Clock seam for `generatedAt` (tests pin it). */
  now?: () => Date
}

/** One entry per claim: the first reason wins (a claim covered by a later flow is
 *  filtered out by the honesty rule long before it reaches here). */
function dedupeNoFlowClaims(claims: readonly GuardNoFlowClaim[]): GuardNoFlowClaim[] {
  const seen = new Set<string>()
  const out: GuardNoFlowClaim[] = []
  for (const c of claims) {
    const key = claimKey(c.doc, c.anchor, c.claimTitle)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(c)
  }
  return out
}

/** An area that produced no flows, with why — reported, never silently dropped. */
export interface UnsettledArea {
  areaId: string
  reason: string
}

export interface FlowSynthesisResult {
  flows: GuardFlow[]
  noFlowClaims: GuardNoFlowClaim[]
  /** Committed flows no re-synthesized flow claimed — their scenarios go stale. */
  orphaned: GuardFlow[]
  /** Near-duplicates the subsumption pass dropped. */
  subsumed: SubsumedFlow[]
  /** Areas (and the epic pass, as `(epic)`) that failed to settle. */
  unsettled: UnsettledArea[]
  /** LLM calls made, re-asks included. */
  calls: number
  /** Absolute path written, when `write` was not disabled. */
  path?: string
}

/**
 * Synthesize the flow corpus: compose each area's claims into flows, chain them
 * into epics, drop near-duplicates, resolve identity against the committed corpus,
 * and write `scenarios/flows.json`.
 *
 * Failure is per area and never fatal: an area that cannot settle contributes no
 * flows and is reported in `unsettled` while every other area's flows are written.
 */
export async function synthesizeFlows(opts: SynthesizeFlowsOptions): Promise<FlowSynthesisResult> {
  const { repoRoot, runner, sectionFingerprints } = opts
  const run: ConcurrencyLimit = opts.limit ?? ((fn) => fn())

  // Claims whose section has no live fingerprint cannot be bound, so they never
  // enter synthesis — they are recorded as no-flow claims with that reason.
  const unbindable: GuardNoFlowClaim[] = []
  const areas: FlowSynthesisArea[] = opts.areas.map((area) => {
    const claims = area.claims.filter((c) => {
      if (sectionFingerprints.has(flowSectionKey(c.doc, c.anchor))) return true
      unbindable.push({
        doc: c.doc,
        anchor: c.anchor,
        claimTitle: c.title,
        reason: 'its section is not in the live section index, so no flow can bind it',
      })
      return false
    })
    return { ...area, claims }
  })

  // `plan.areas` is index-aligned with `areas` — the same planner the pre-flight
  // estimate runs, so estimate and run agree on every area's cache verdict.
  const plan = await planFlowSynthesis(repoRoot, areas)

  const outcomes = await Promise.all(
    areas.map((area, i) =>
      run(() => synthesizeArea(repoRoot, area, plan.areas[i], runner)).then((got) => {
        opts.onArea?.(area.areaId)
        return got
      }),
    ),
  )

  let calls = 0
  const unsettled: UnsettledArea[] = []
  const noFlowClaims: GuardNoFlowClaim[] = [...unbindable]
  let drafts: DraftFlow[] = []
  outcomes.forEach((outcome, i) => {
    calls += outcome.calls
    if (!outcome.ok) {
      unsettled.push({ areaId: areas[i].areaId, reason: outcome.reason })
      return
    }
    drafts.push(...outcome.flows)
    noFlowClaims.push(...outcome.noFlowClaims)
  })

  const subsumed: SubsumedFlow[] = []
  const areaPass = applySubsumption(drafts)
  drafts = areaPass.kept
  subsumed.push(...areaPass.dropped)

  // Epic pass — only worth a call when more than one area contributed flows. The
  // digest refs are taken BEFORE the epics are appended, so `F<n>` keeps pointing
  // at the same draft index once the combined list is id'd below.
  const composableRefs = new Map(digestsOf(drafts).map((d, i) => [d.ref, i]))
  const areasWithFlows = new Set(drafts.map((f) => f.areaId))
  if (opts.epicRunner && areasWithFlows.size > 1) {
    const index = buildClaimIndex(areas.flatMap((a) => a.claims))
    const epicOutcome = await synthesizeEpics(repoRoot, drafts, index, opts.epicRunner)
    calls += epicOutcome.calls
    if (epicOutcome.error) unsettled.push({ areaId: '(epic)', reason: epicOutcome.error })
    const epicPass = applySubsumption(epicOutcome.epics)
    subsumed.push(...epicPass.dropped)
    drafts = [...drafts, ...epicPass.kept]
  }

  // Bindings + fingerprints, then identity against the committed corpus.
  const provisional = new Set<string>()
  const next: GuardFlow[] = drafts.map((draft) => {
    const bindings: GuardFlowBinding[] = []
    const seenSection = new Set<string>()
    for (const m of draft.milestones) {
      const key = flowSectionKey(m.doc, m.anchor)
      if (seenSection.has(key)) continue
      seenSection.add(key)
      bindings.push({ doc: m.doc, anchor: m.anchor, fingerprint: sectionFingerprints.get(key)! })
    }
    const id = freeId(slugForTitle(draft.title), provisional)
    provisional.add(id)
    return {
      id,
      title: draft.title,
      goal: draft.goal,
      fingerprint: flowFingerprint(draft.milestones),
      milestones: draft.milestones,
      bindings,
      composedOf: [],
      synthesisInputsHash: draft.synthesisInputsHash,
    }
  })

  const previous = opts.previous ?? readFlowsFile(repoRoot)?.flows ?? []
  const { verdicts, orphaned } = resolveFlowIdentity(previous, next)
  const taken = new Set<string>()
  // Inherited ids (remap/stale) claim first: a flow that keeps its identity keeps
  // its handle, and a NEW flow whose slug collides moves to `-N` instead.
  verdicts.forEach((v, i) => {
    if (v.kind === 'new') return
    next[i].id = v.id
    taken.add(v.id)
  })
  verdicts.forEach((v, i) => {
    if (v.kind !== 'new') return
    next[i].id = freeId(slugForTitle(next[i].title), taken)
    taken.add(next[i].id)
  })

  // Epic provenance: digest refs become the composed flows' final ids.
  drafts.forEach((draft, i) => {
    if (draft.composedRefs.length === 0) return
    next[i].composedOf = draft.composedRefs
      .map((ref) => {
        const at = composableRefs.get(ref)
        return at === undefined ? undefined : next[at].id
      })
      .filter((id): id is string => Boolean(id))
  })

  const file: GuardFlowsFile = GuardFlowsFileSchema.parse({
    version: 1,
    generatedAt: (opts.now?.() ?? new Date()).toISOString(),
    flows: next,
    noFlowClaims: dedupeNoFlowClaims(noFlowClaims),
  })

  const result: FlowSynthesisResult = {
    flows: file.flows,
    noFlowClaims: file.noFlowClaims,
    orphaned,
    subsumed,
    unsettled,
    calls,
  }
  // A wipeout NEVER rewrites `flows.json`: the corpus it would write is the loss,
  // not an answer, and the file is committable — a clobbered one takes every
  // committed flow's identity with it. Left untouched, the next run re-synthesizes
  // against it. `generateGuards` aborts the run on this same predicate.
  if (opts.write !== false && !isFlowSynthesisWipeout(result)) {
    const target = flowsPath(repoRoot)
    atomicWriteJson(target, file)
    result.path = target
  }
  return result
}

/**
 * Every area that reached the model came back unusable and not ONE flow survived —
 * the calls answered (so no transport tally records it) and every reply failed
 * validation twice. A synthesis that spent calls and produced nothing is a loss,
 * never "the docs state no flows": that reads as an empty corpus and orphans every
 * committed flow.
 */
export function isFlowSynthesisWipeout(
  r: Pick<FlowSynthesisResult, 'flows' | 'unsettled' | 'calls'>,
): boolean {
  return r.flows.length === 0 && r.unsettled.length > 0 && r.calls > 0
}
