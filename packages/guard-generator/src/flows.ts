/**
 * Flow SYNTHESIS — the spec-side generation unit, run as `guard-generate.flows`
 * agent sessions (plan 04 step 16; the per-area one-shots + their corrective
 * re-ask were retired by step 20). One session per AREA composes that area's
 * already-extracted claims into user-goal paths (flows); one epic session,
 * after the area pool, chains the results into cross-area epics. The output is
 * `.truecourse/scenarios/flows.json`, the committable flow corpus scenarios
 * reference by id.
 *
 * THE INDEPENDENCE INVARIANT, session form: the briefing carries interface
 * DIGESTS and the dependency catalog as GROUNDING — orientation for
 * composition — while the binding rule survives whole: a milestone snaps onto
 * a CLAIM, never onto an interface, so an unrealizable milestone is still a
 * real signal.
 *
 * The model may only ORDER and GROUP claims: every milestone is SNAPPED back
 * onto the area's claim inventory (unknown references are rejected), and every
 * runnable claim must land in a flow or carry a stated no-flow reason. The
 * session's `check_flows` tool tells it in-session; the FOLD here re-validates
 * every outcome regardless (never trust a transcript), and an area whose value
 * still fails stays UNSETTLED (no flows, reported) rather than emitting
 * invented paths.
 *
 * The session cache (name `guard/flows`, kept from the one-shot stage) lives in
 * `@truecourse/core`, which owns the session prompts; its keys hash the SAME
 * claim/outline material through {@link flowAreaClaimsMaterial} /
 * {@link flowAreaOutlinesMaterial} / {@link flowEpicDigestsMaterial}, exported
 * for exactly that (and for the pre-flight estimate, which probes the same keys).
 */

import { createHash } from 'node:crypto'
import {
  atomicWriteJson,
  guardFlowsPath,
  readGuardFlowsCorpus,
  slugifyHeading,
} from '@truecourse/guard-runner'
import {
  GuardFlowsFileSchema,
  flowFingerprint,
  flowMilestoneKey,
  resolveFlowIdentity,
  isRunnableDriver,
  type ClaimNeed,
  type GuardDriverId,
  type GuardFlow,
  type GuardFlowBinding,
  type GuardFlowMilestone,
  type GuardFlowsFile,
  type GuardNoFlowClaim,
} from '@truecourse/shared'
import {
  type EpicSynthesis,
  type FlowSynthesis,
  type SynthesizedMilestone,
} from './schemas.js'
import { type FlowDigest, type OutlineEntry } from './prompts.js'
import type { GuardSessionSummary } from './extract.js'
import type { GuardDoc } from './section-plan.js'
import type { InterfaceDigest } from './prompts.js'

/** The committed flow corpus — next to `manifest.json`, same commit story. */
export const flowsPath = guardFlowsPath

/** Read the committed flows file, or `null` when absent/unparseable. */
export const readFlowsFile = readGuardFlowsCorpus

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
  /**
   * The extraction session's structured needs for this claim (plan 04 step 15),
   * read by flow synthesis (and its `check_flows` needs-vs-catalog binding).
   * Advisory — they steer composition, never gate it.
   */
  needs?: ClaimNeed[]
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
// Cache-key material (hashed by core's session keys and the pre-flight estimate)
// ---------------------------------------------------------------------------

function normalizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * The area's claim-set serialization: identity + surface (+ needs, appended ONLY
 * when a claim carries any — so a one-shot inventory keys byte-identically to
 * before needs existed), order-independent. Exported because the session cache
 * key (core, `guard-generate.flows`) hashes the SAME material under its own
 * prompt fingerprint — one serializer, two keys that can never drift apart.
 */
export function flowAreaClaimsMaterial(area: FlowSynthesisArea): string {
  return area.claims
    .map((c) => {
      const base = `${c.doc}\0${normalizeText(c.anchor)}\0${normalizeText(c.title)}\0${c.driver}`
      const needs = (c.needs ?? [])
        .map((n) => `${n.kind}\0${normalizeText(n.name)}${n.detail ? `\0${normalizeText(n.detail)}` : ''}`)
        .sort()
        .join('')
      return needs ? `${base}\0needs:${needs}` : base
    })
    .sort()
    .join('\n')
}

/** The area's document-outline serialization — the other half of its content key. */
export function flowAreaOutlinesMaterial(area: FlowSynthesisArea): string {
  return area.docs
    .map((d) => {
      const sections = d.outline.map((e) => `${e.anchor}\0${normalizeText(e.headingText)}\0${e.level}`).join('\n')
      const untestable = (d.untestable ?? []).map((u) => `${u.anchor}\0${normalizeText(u.reason)}`).sort().join('\n')
      return `${d.doc}\n${sections}\n${untestable}`
    })
    .sort()
    .join('\n--\n')
}

/** The epic digests' serialization — hashed by the session key (core) and the
 *  pre-flight estimate, so the two can never drift. */
export function flowEpicDigestsMaterial(digests: readonly FlowDigest[]): string {
  return digests
    .map((d) => [d.areaId, d.title, d.goal, ...d.milestones.map((m) => `${m.doc}\0${m.anchor}\0${normalizeText(m.claimTitle)}`)].join('\n'))
    .join('\n--\n')
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
// The session CHECKER (plan 04 step 16) — the det post-passes as one callable.
// The `guard-generate.flows` session's `check_flows` tool runs it live (defects
// come back as observations instead of silent drops), and the fold re-runs the
// refusal half through `validateAreaSynthesis` — never trust the transcript.
// ---------------------------------------------------------------------------

export interface FlowSetCheckContext {
  /** The area whose claim inventory the draft must snap onto. */
  area: FlowSynthesisArea
  /** Live {@link flowSectionKey}s — the bindability check. Omit to skip. */
  sectionKeys?: ReadonlySet<string>
  /** Dependency-catalog entry names — the needs-binding check. Omit to skip. */
  catalogNames?: ReadonlySet<string>
}

/**
 * Every defect class the checker knows. The first two REFUSE an outcome (they
 * are exactly the criteria the one-shot re-ask corrected); the rest are
 * OBSERVATIONS — the fold handles them deterministically (subsumption is
 * APPLIED there, per tier with the coverage gate) or records them, and the
 * session only hears about them so it can do better in the same turn.
 */
export interface FlowSetCheckReport {
  /** Milestone / noFlowClaims references that snap onto no given claim. REFUSAL. */
  unknownReferences: string[]
  /** `account: required` claims in no flow and no noFlowClaims entry. REFUSAL. */
  uncoveredClaims: string[]
  /** Contiguous near-duplicates the det fold will drop (report, don't delete). */
  subsumed: SubsumedFlow[]
  /** Milestones whose section is outside the live index — no flow can bind them. */
  unbindable: string[]
  /** Claim needs naming no dependency-catalog entry (observation only). */
  unboundNeeds: string[]
}

/** True when the report carries no refusal-class defect. */
export function isFlowSetClean(report: Pick<FlowSetCheckReport, 'unknownReferences' | 'uncoveredClaims'>): boolean {
  return report.unknownReferences.length === 0 && report.uncoveredClaims.length === 0
}

export function checkFlowSet(data: FlowSynthesis, ctx: FlowSetCheckContext): FlowSetCheckReport {
  const index = buildClaimIndex(ctx.area.claims)
  // The inputs hash is irrelevant to a check — the drafts are discarded.
  const v = validateAreaSynthesis(ctx.area, data, index, '')
  const subsumed = applySubsumption(v.flows).dropped

  const unbindable: string[] = []
  const unboundNeeds: string[] = []
  const seenNeed = new Set<string>()
  for (const flow of v.flows) {
    for (const m of flow.milestones) {
      if (ctx.sectionKeys && !ctx.sectionKeys.has(flowSectionKey(m.doc, m.anchor))) {
        unbindable.push(`${m.doc}#${m.anchor} — "${normalizeText(m.claimTitle)}"`)
      }
      if (!ctx.catalogNames) continue
      const claim = index.byKey.get(claimKey(m.doc, m.anchor, m.claimTitle))
      for (const need of claim?.needs ?? []) {
        if (ctx.catalogNames.has(need.name) || seenNeed.has(need.name)) continue
        seenNeed.add(need.name)
        unboundNeeds.push(`"${need.name}" (${need.kind}) — named by "${normalizeText(m.claimTitle)}" but in no dependency-catalog entry`)
      }
    }
  }

  return {
    unknownReferences: v.unknownReferences,
    uncoveredClaims: v.uncoveredClaims,
    subsumed,
    unbindable,
    unboundNeeds,
  }
}

/**
 * The epic half of the checker, restricted to the composed flows' milestones —
 * mirrors `synthesizeEpics`' engine validation exactly. `notes` carry the det
 * drop rules (<2 known refs, <2 snapped milestones) as observations: the fold
 * applies them silently, the session gets to fix them.
 */
export function checkEpicSet(
  data: EpicSynthesis,
  digests: readonly FlowDigest[],
  claims: readonly FlowClaimInput[],
): { unknownReferences: string[]; notes: string[] } {
  const index = buildClaimIndex(claims)
  const byRef = new Map(digests.map((d) => [d.ref, d]))
  const unknownReferences: string[] = []
  const notes: string[] = []
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
      notes.push(`"${normalizeText(epic.title)}" chains fewer than two known flows — it will be dropped`)
      continue
    }
    const allowed = new Set<string>()
    for (const r of refs) {
      for (const m of byRef.get(r)!.milestones) allowed.add(claimKey(m.doc, m.anchor, m.claimTitle))
    }
    let snapped = 0
    for (const milestone of epic.milestones) {
      const claim = snapClaim(milestone, index)
      if (!claim || !allowed.has(claimKey(claim.doc, claim.anchor, claim.title))) {
        unknownReferences.push(describeRef(milestone))
        continue
      }
      snapped++
    }
    if (snapped < 2) notes.push(`"${normalizeText(epic.title)}" keeps fewer than two snapped milestones — it will be dropped`)
  }
  return { unknownReferences, notes }
}

// ---------------------------------------------------------------------------
// Per-area fold shapes
// ---------------------------------------------------------------------------

/** One area's validated session value, as the fold routes it. */
type AreaOutcome =
  | { ok: true; flows: DraftFlow[]; noFlowClaims: GuardNoFlowClaim[] }
  | { ok: false; reason: string }

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

/**
 * Build epic drafts out of an epic-pass reply: resolve the composed refs, snap
 * every milestone against the inventory RESTRICTED to the composed flows'
 * milestones, apply the det drop rules (<2 known refs, <2 snapped milestones),
 * and stamp `inputsKey` as the drafts' synthesis-inputs hash — the ONE engine
 * validation of an epic value, whichever session (or cache entry) produced it.
 */
function buildEpicDrafts(
  data: { epics: { title: string; goal: string; composedOf: string[]; milestones: SynthesizedMilestone[] }[] },
  flows: readonly DraftFlow[],
  index: ClaimIndex,
  inputsKey: string,
): { epics: DraftFlow[]; unknownReferences: string[] } {
  const digests = digestsOf(flows)
  const byRef = new Map(digests.map((d, i) => [d.ref, i]))
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
      synthesisInputsHash: inputsKey,
    })
  }
  return { epics, unknownReferences }
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
// The flow-synthesis SESSION seams (plan 04 step 16) — typed here because the
// engine cannot depend on `@truecourse/core`, which owns the sessions; the
// command adapter injects the implementations (same pattern as plan 03's
// guard-setup seams and the extract seam above).
// ---------------------------------------------------------------------------

/**
 * The grounding a flows-session briefing carries BEYOND the spec-side inputs:
 * the interface digests per surface (id/title/entry/steps — no paths; built off
 * the post-procedure-gate surface catalogs, so RPC-derived operations never
 * appear) and the dependency catalog's names + classes. Deliberately OUTSIDE
 * the session cache key (the plan's stated key is prompt :: areaId :: claims ::
 * outlines): grounding orients composition the way tool results do, and keying
 * on the whole catalog would re-synthesize every area on unrelated route churn.
 */
export interface FlowsSessionGrounding {
  interfaces: { surface: GuardDriverId; digests: InterfaceDigest[] }[]
  dependencies: { name: string; class: string }[]
}

export type FlowsAreaSessionResult =
  | { ok: true; value: FlowSynthesis; fromCache?: boolean; inputsKey: string }
  | { ok: false; reason: string }

export type FlowsEpicSessionResult =
  | { ok: true; value: EpicSynthesis; fromCache?: boolean; inputsKey: string }
  | { ok: false; reason: string }

/**
 * The per-area flow-synthesis session seam: one `guard-generate.flows` session
 * per cache-missing area (the implementation pools them). Each result carries
 * the session cache key it keyed on (`inputsKey`) — stamped as the produced
 * flows' `synthesisInputsHash`, so the corpus records the inputs that actually
 * generated it, whichever engine ran.
 */
export type FlowsAreaSessionSeam = (input: {
  areas: readonly FlowSynthesisArea[]
  grounding?: FlowsSessionGrounding
  /** The work docs (section texts) the sessions' `read_section` reads from. */
  docs?: readonly GuardDoc[]
  /** Ticks once per settled area (cache hits included). */
  onArea?: (areaId: string) => void
}) => Promise<{ byArea: Map<string, FlowsAreaSessionResult>; summary: GuardSessionSummary }>

/** The epic session seam — one session over the flow digests, after the area pool. */
export type FlowsEpicSessionSeam = (input: {
  digests: readonly FlowDigest[]
  /** The whole run's claim inventory — the epic checker's snapping set. */
  claims: readonly FlowClaimInput[]
  grounding?: FlowsSessionGrounding
  docs?: readonly GuardDoc[]
}) => Promise<{ result: FlowsEpicSessionResult; summary: GuardSessionSummary }>

// ---------------------------------------------------------------------------
// synthesizeFlows
// ---------------------------------------------------------------------------

export interface SynthesizeFlowsOptions {
  repoRoot: string
  /** The areas to synthesize — every area whose claim inventory the run knows. */
  areas: readonly FlowSynthesisArea[]
  /**
   * The per-area SESSION seam (plan 04 step 16) — THE synthesis path since the
   * one-shot retirement (step 20). The fold below re-validates every session
   * value against the live claim inventory regardless.
   */
  areaSession: FlowsAreaSessionSeam
  /** The epic SESSION seam — one session over the digests, after the area pool. */
  epicSession: FlowsEpicSessionSeam
  /** Interface digests + dependency catalog for the session briefings. */
  sessionGrounding?: FlowsSessionGrounding
  /** The work docs (section texts) for the sessions' `read_section` tool. */
  sessionDocs?: readonly GuardDoc[]
  /** `doc`+`anchor` ({@link flowSectionKey}) → the section's live fingerprint. */
  sectionFingerprints: ReadonlyMap<string, string>
  /** The committed flows identity resolves against; defaults to `flows.json`. */
  previous?: readonly GuardFlow[]
  /** False to compute without writing `flows.json` (callers that stage the write). */
  write?: boolean
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
  /** Sessions that actually RAN across the area pool + the epic session
   *  (cache hits excluded) — the wipeout guard's spend witness. */
  calls: number
  /** Session-kind summaries, present only when the session seams ran — the
   *  caller's systemic-loss gate and llm-failure tallies read these. */
  sessionSummaries?: GuardSessionSummary[]
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
  const { repoRoot, sectionFingerprints } = opts

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

  const sessionSummaries: GuardSessionSummary[] = []
  let calls = 0
  // One agent session per cache-missing area, pooled by the seam. The seam's
  // `check_flows` already refused dirty outcomes, but the fold NEVER trusts a
  // transcript (or a cache entry): every value is re-validated against the live
  // claim inventory right here, and a dirty one lands the area in `unsettled`
  // exactly like a failed session.
  const { byArea, summary } = await opts.areaSession({
    areas,
    ...(opts.sessionGrounding ? { grounding: opts.sessionGrounding } : {}),
    ...(opts.sessionDocs ? { docs: opts.sessionDocs } : {}),
    onArea: (areaId) => opts.onArea?.(areaId),
  })
  sessionSummaries.push(summary)
  calls += summary.ran
  const outcomes: AreaOutcome[] = areas.map((area): AreaOutcome => {
    const r = byArea.get(area.areaId)
    if (!r) return { ok: false, reason: 'the flows session produced no result for this area' }
    if (!r.ok) return { ok: false, reason: r.reason }
    const v = validateAreaSynthesis(area, r.value, buildClaimIndex(area.claims), r.inputsKey)
    if (v.unknownReferences.length > 0 || v.uncoveredClaims.length > 0) {
      const parts: string[] = []
      if (v.unknownReferences.length > 0) parts.push(`${v.unknownReferences.length} milestone(s) matched no claim (${v.unknownReferences[0]})`)
      if (v.uncoveredClaims.length > 0) parts.push(`${v.uncoveredClaims.length} claim(s) left unaccounted (${v.uncoveredClaims[0]})`)
      return { ok: false, reason: `flow synthesis refused: ${parts.join('; ')}` }
    }
    return { ok: true, flows: v.flows, noFlowClaims: v.noFlowClaims }
  })

  const unsettled: UnsettledArea[] = []
  const noFlowClaims: GuardNoFlowClaim[] = [...unbindable]
  let drafts: DraftFlow[] = []
  outcomes.forEach((outcome, i) => {
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
  if (areasWithFlows.size > 1) {
    // The epic SESSION (a true barrier after the area pool). Same fold
    // discipline as the areas: the seam's value is rebuilt through the engine
    // validation (`buildEpicDrafts`), so an epic can never smuggle in a claim
    // its composed flows don't cover.
    const claims = areas.flatMap((a) => a.claims)
    const { result: epicResult, summary } = await opts.epicSession({
      digests: digestsOf(drafts),
      claims,
      ...(opts.sessionGrounding ? { grounding: opts.sessionGrounding } : {}),
      ...(opts.sessionDocs ? { docs: opts.sessionDocs } : {}),
    })
    sessionSummaries.push(summary)
    calls += summary.ran
    if (!epicResult.ok) {
      unsettled.push({ areaId: '(epic)', reason: epicResult.reason })
    } else {
      const built = buildEpicDrafts(epicResult.value, drafts, buildClaimIndex(claims), epicResult.inputsKey)
      if (built.unknownReferences.length > 0) {
        unsettled.push({ areaId: '(epic)', reason: `epic pass refused: ${built.unknownReferences[0]}` })
      } else {
        const epicPass = applySubsumption(built.epics)
        subsumed.push(...epicPass.dropped)
        drafts = [...drafts, ...epicPass.kept]
      }
    }
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
    ...(sessionSummaries.length > 0 ? { sessionSummaries } : {}),
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
