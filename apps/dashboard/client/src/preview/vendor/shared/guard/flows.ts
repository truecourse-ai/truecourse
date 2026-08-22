// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's packages/shared/src/guard/flows.ts; delete with the preview.
/**
 * Guard FLOWS, the spec-side generation unit (WHAT to test), stored in
 * `.truecourse/scenarios/flows.json` (committable, next to `manifest.json`).
 *
 * A flow is a user-goal path through the product: a title, a goal statement, an
 * ordered list of MILESTONES, and the spec-section bindings those milestones come
 * from. Every milestone references an extracted claim, synthesis may order and
 * group claims into paths, never invent an assertion, so a flow states what the
 * product should do, derived from the spec corpus alone.
 *
 * Identity is deliberately NOT the title (model-authored, unstable across
 * re-synthesis): a flow keeps its `id` through re-synthesis by MILESTONE OVERLAP -
 * see {@link resolveFlowIdentity}. {@link flowFingerprint} hashes the ordered
 * milestone composition, mirroring the section fingerprint's normalize-then-sha256
 * rule so re-wrapped prose never moves it.
 */

import crypto from 'node:crypto'
import { z } from 'zod'
import type { GuardCoverageGapKind } from './report'

/**
 * One step of a flow's path: an extracted claim, addressed by the section it was
 * extracted under. `order` is the position in the path (1-based); `claimTitle` is
 * the extracted claim's stable text, the same identity `dismissedClaimKey` uses.
 */
export const GuardFlowMilestoneSchema = z
  .object({
    /** 1-based position in the flow's path. */
    order: z.number().int().positive(),
    /** Repo-relative path of the spec document the claim lives in. */
    doc: z.string().min(1),
    /** Slugified heading path (the section anchor) the claim was extracted under. */
    anchor: z.string().min(1),
    /** The extracted claim's stable text. */
    claimTitle: z.string().min(1),
    /** Optional free-text note from synthesis (why this step sits here). */
    note: z.string().optional(),
  })
  .strict()
export type GuardFlowMilestone = z.infer<typeof GuardFlowMilestoneSchema>

/**
 * A section a flow binds to, the staleness anchor. Same triple as a scenario's
 * `binds` entry (`doc` + section anchor + the section-text fingerprint), resolved
 * through the runner's `resolveBinding` against the live section index.
 */
export const GuardFlowBindingSchema = z
  .object({
    /** Repo-relative path of the spec document. */
    doc: z.string().min(1),
    /** Slugified heading path (the section anchor). */
    anchor: z.string().min(1),
    /** `sha256:…` over the normalized section text at synthesis time. */
    fingerprint: z.string().min(1),
  })
  .strict()
export type GuardFlowBinding = z.infer<typeof GuardFlowBindingSchema>

/**
 * What KIND of path a flow walks. Coverage is not a count of flows but a spread
 * over these: `happy` is the documented golden path, `edge` an error path,
 * invalid input, a boundary value or an empty/conflicting state, and `variant` one
 * of the alternative configuration paths of a capability the program offers a
 * choice for (a transport, a policy toggle). Without the field, "does this corpus
 * exercise anything but the happy path?" is unanswerable from the store.
 */
export const GuardFlowKindSchema = z.enum(['happy', 'edge', 'variant'])
export type GuardFlowKind = z.infer<typeof GuardFlowKindSchema>

/**
 * The world a flow's scenario starts from, split by HOW the state is obtained -
 * the three dependency classes, in preference order:
 *
 *  - `stepCreatable`, the public surface itself creates it, so the scenario
 *    builds it through its own steps and seeds nothing;
 *  - `seedable`, materialized deterministically before the steps (files, git
 *    history, env), travelling with the scenario;
 *  - `supplied`, real-world input the engine must never fabricate (a real
 *    codebase, a logged-in binary, credentials). Named here and bound at run time
 *    from what the user registered; unregistered means THIS flow blocks, loudly,
 *    while its siblings still run.
 *
 * Each entry is one plain sentence naming the state (and, for `supplied`, the
 * dependency). Written by synthesis, read by the runner's binding and by the
 * dashboard's blocked-flow surface.
 */
export const GuardFlowStartingStateSchema = z
  .object({
    stepCreatable: z.array(z.string().min(1)).default([]),
    seedable: z.array(z.string().min(1)).default([]),
    supplied: z.array(z.string().min(1)).default([]),
  })
  .strict()
export type GuardFlowStartingState = z.infer<typeof GuardFlowStartingStateSchema>

export const GuardFlowSchema = z
  .object({
    /** Slugified title, `-N` disambiguated, the stable handle scenarios reference. */
    id: z.string().min(1),
    title: z.string().min(1),
    /** One-line statement of the user goal the path achieves. */
    goal: z.string().min(1),
    /** The path's kind, see {@link GuardFlowKindSchema}. */
    kind: GuardFlowKindSchema.optional(),
    /**
     * For a `variant` flow: the id of the flow whose configuration path it varies
     * (the claude-code transport vs the api transport, `llm: false` vs `true`).
     * NOT `composedOf`, which means the opposite relation, an epic chaining
     * sub-flows, and would lie about the link.
     */
    variantOf: z.string().min(1).optional(),
    /**
     * The authoring rationale: why the flow has this shape, what a milestone
     * honestly proves, and the interface gaps found while writing it. The reviewable
     * substance behind a flow, which its title and goal cannot carry.
     */
    notes: z.string().min(1).optional(),
    /** The world the flow starts from. See {@link GuardFlowStartingStateSchema}. */
    startingState: GuardFlowStartingStateSchema.optional(),
    /** `sha256:…` over the milestone composition, see {@link flowFingerprint}. */
    fingerprint: z.string().min(1),
    /** The path, in order. At least one milestone (an atomic flow is one claim). */
    milestones: z.array(GuardFlowMilestoneSchema).min(1),
    /** The sections the milestones come from, the flow's staleness anchors. */
    bindings: z.array(GuardFlowBindingSchema).min(1),
    /** Ids of the flows an epic flow chains (empty for a non-epic flow). */
    composedOf: z.array(z.string()).default([]),
    /** Content key over the synthesis inputs that produced this flow. */
    synthesisInputsHash: z.string().min(1),
  })
  .strict()
export type GuardFlow = z.infer<typeof GuardFlowSchema>

/**
 * A runnable claim synthesis placed in NO flow, with the reason, the coverage
 * honesty rule (every runnable claim lands in a flow or is accounted for here).
 */
export const GuardNoFlowClaimSchema = z
  .object({
    doc: z.string().min(1),
    anchor: z.string().min(1),
    claimTitle: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict()
export type GuardNoFlowClaim = z.infer<typeof GuardNoFlowClaimSchema>

/**
 * The gap KIND a no-flow claim's reason states, the bridge that makes a section
 * whose claims all sit here derive a real coverage status instead of a mute
 * bucket. Synthesis writes the reason as prose (one sentence, the model's own
 * words), so the kind is read back from what the sentence SAYS, exactly as the
 * `blocked-on` capability nouns are.
 *
 * The ladder is ordered, first match wins, and the two answers that matter are the
 * BLOCKED half (`no-interface` / `blocked-on`: something named stands in the way,
 * and clearing it turns the claim into a flow) and the NOT-TESTABLE half
 * (`unrealizable` / `untestable`: a settled answer nobody can act on).
 *
 * The default is `untestable` and not `blocked-on`: a reason that names no blocker
 * has none to name, and inventing one would put a to-do on a user's list that
 * nothing can ever clear.
 */
export function guardNoFlowClaimGapKind(reason: string): GuardCoverageGapKind {
  const text = reason.replace(/\s+/g, ' ').trim()
  // "no `cli/guard` interface has been derived", "no interface exists", the mapper
  // found nothing to step through. Word-adjacent so a passing mention of the word
  // ("interface decision `phase-0-transport`") can never match.
  if (/\bno\s+(?:\S+\s+){0,2}interface\b/i.test(text)) return 'no-interface'
  // The claim's own lead states the verdict, "blocked-on the supplied `x`
  // dependency: …", "needs dotnet-sdk. …". A blocker named anywhere in the
  // sentence still counts ("Blocked on both the supplied SDK and …").
  if (/\bblocked[- ]on\b|^\s*(?:needs|requires|awaiting)\b/i.test(text)) return 'blocked-on'
  // The spec promises something no code surface offers, or the runner's own rules
  // forbid observing it. A settled answer either way.
  if (/\bunrealizable\b/i.test(text)) return 'unrealizable'
  return 'untestable'
}

// --- The flow-worker session outcome (plan 04 step 17) ----------------------

/**
 * One PREDICTED red step of a submitted scenario, the flow worker's own verdict
 * on a doc-vs-code disagreement it confirmed by running the scenario. A red
 * submission is accepted ONLY when the engine's fresh confirmation run reproduces
 * every declared prediction (`predictedActual` against the observed actual), so a
 * committed red test carries the worker's adjudication as its diagnosis instead
 * of a separate triage stage's.
 */
export const GuardExpectedRedSchema = z
  .object({
    /** 1-based failing step of the submitted scenario. */
    step: z.number().int().positive(),
    /** The actual the worker OBSERVED (copied off its own run) and predicts the
     *  confirmation run reproduces. */
    predictedActual: z.string().min(1),
    /** The worker's drift verdict, `generation-defect` is deliberately absent:
     *  a worker that authored a defective scenario fixes or retires it in-loop. */
    verdict: z.enum(['doc-drift', 'code-drift']),
    /** One-paragraph plain-words assessment, the committed red's diagnosis brief. */
    brief: z.string().min(1),
  })
  .strict()
export type GuardExpectedRed = z.infer<typeof GuardExpectedRedSchema>

/** Which payload fields each outcome kind requires, the pairing the flattened
 *  schema's `superRefine` enforces (see {@link GuardFlowWorkerOutcomeSchema}). */
const FLOW_WORKER_PAYLOAD_FIELDS = {
  settled: ['scenarioYamlSha', 'expectedReds'],
  blocked: ['perMilestone'],
  'journey-defect': ['report'],
  retired: ['attempts', 'lastEvidence'],
} as const satisfies Record<string, readonly string[]>

/**
 * The `guard-generate.flow-worker` session's outcome (plan 04 step 17) -
 * exhaustive: a worker cannot end without one of these four kinds.
 *
 * ONE object discriminated by `kind`, carrying exactly the payload fields that
 * match it, deliberately NOT a `z.discriminatedUnion`: a union renders as a
 * root-level `anyOf` JSON schema, and the drivers hand this schema to provider
 * surfaces that require an OBJECT root (the api driver's injected `outcome`
 * tool inputSchema, the Agent SDK driver's `outputFormat` json-schema). The
 * pairing the union used to encode structurally is enforced by the
 * `superRefine`, the loop parses every outcome against this schema before
 * completing a session, so a kind without its payload fails `malformed` there.
 * Same recipe as guard-setup's `AuthProofOutcomeSchema`.
 *
 * The flattening is SHAPE-COMPATIBLE with existing `guard/generate` cache
 * entries: a stored `{kind: 'settled'|'blocked', …}` object carries exactly
 * its kind's fields under the same names, so old entries still parse as hits.
 *
 * `settled` references the ENGINE-STASHED accepted scenario by the sha the
 * `submit_scenario` acceptance reported, the fold takes the yaml from the stash,
 * never from the outcome text. No `.default()` anywhere: a session outcome
 * schema must be Input≡Output (`SessionDef.outcomeSchema` is `z.ZodType<T>`).
 */
export const GuardFlowWorkerOutcomeSchema = z
  .object({
    kind: z.enum(['settled', 'blocked', 'journey-defect', 'retired']),
    /** settled: sha256 of the accepted scenario yaml, verbatim from the acceptance. */
    scenarioYamlSha: z.string().min(1).optional(),
    /** settled: the declared red predictions, exactly as submitted (empty on a green). */
    expectedReds: z.array(GuardExpectedRedSchema).optional(),
    /** blocked: per-milestone capability the sandbox cannot provide (order = milestone). */
    perMilestone: z
      .array(z.object({ order: z.number().int().positive(), capability: z.string().min(1) }).strict())
      .min(1)
      .optional(),
    /** journey-defect: the derived interface the worker found wrong against the real app. */
    report: z.object({ interfaceId: z.string().min(1), detail: z.string().min(1) }).strict().optional(),
    /** retired: how many authoring attempts the worker spent before giving up. */
    attempts: z.number().int().nonnegative().optional(),
    /** retired: the last run's evidence, why no faithful scenario could be produced. */
    lastEvidence: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const wanted: readonly string[] = FLOW_WORKER_PAYLOAD_FIELDS[value.kind]
    const allFields = Object.values(FLOW_WORKER_PAYLOAD_FIELDS).flat()
    for (const field of allFields) {
      const present = value[field as keyof typeof value] !== undefined
      if (wanted.includes(field) && !present) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `kind "${value.kind}" requires \`${field}\``,
        })
      } else if (!wanted.includes(field) && present) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `kind "${value.kind}" must not carry \`${field}\``,
        })
      }
    }
  })
export type GuardFlowWorkerOutcome = z.infer<typeof GuardFlowWorkerOutcomeSchema>

/** `.truecourse/scenarios/flows.json`, the synthesized flow corpus. */
export const GuardFlowsFileSchema = z
  .object({
    version: z.literal(1),
    /** ISO timestamp of the synthesis run that wrote the file. */
    generatedAt: z.string(),
    flows: z.array(GuardFlowSchema),
    /** Runnable claims no flow covers, each with its reason. */
    noFlowClaims: z.array(GuardNoFlowClaimSchema).default([]),
  })
  .strict()
export type GuardFlowsFile = z.infer<typeof GuardFlowsFileSchema>

// --- Fingerprint & identity ------------------------------------------------

/**
 * THE canonical milestone normalization: every whitespace run folds to a single
 * space and the ends are trimmed, the section-fingerprint rule, applied to the
 * milestone's identity fields, so re-wrapped claim text never moves a flow.
 */
function normalizeMilestoneText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * A milestone's identity: its section anchor plus its claim text, normalized. The
 * ONE key {@link flowFingerprint} hashes and {@link resolveFlowIdentity} compares,
 * so the fingerprint and the identity resolution can never disagree about what
 * makes two milestones "the same".
 */
export function flowMilestoneKey(milestone: Pick<GuardFlowMilestone, 'anchor' | 'claimTitle'>): string {
  return `${normalizeMilestoneText(milestone.anchor)}\u0000${normalizeMilestoneText(milestone.claimTitle)}`
}

/**
 * `sha256:<hex>` over the flow's ORDERED milestone list (each milestone's anchor +
 * claim text, normalized). Milestones are folded in `order`, so the array's
 * incidental order never matters but re-sequencing the path does, a flow's
 * fingerprint answers "did the composition of what this flow tests change?".
 */
export function flowFingerprint(milestones: readonly GuardFlowMilestone[]): string {
  const ordered = [...milestones].sort((a, b) => a.order - b.order)
  const digest = crypto
    .createHash('sha256')
    .update(ordered.map(flowMilestoneKey).join('\n'), 'utf-8')
    .digest('hex')
  return `sha256:${digest}`
}

/**
 * The milestone-overlap share above which a re-synthesized flow inherits a prior
 * flow's id (STALE in place). Measured against the LARGER of the two milestone
 * sets, so a one-milestone flow can never claim a ten-milestone predecessor.
 */
export const FLOW_IDENTITY_OVERLAP_THRESHOLD = 0.5

/**
 * What happens to one re-synthesized flow's identity:
 *  - `remap`, its milestone multiset is identical to a prior flow's; it keeps that
 *    flow's `id` (and takes the new title).
 *  - `stale`, it overlaps a prior flow past {@link FLOW_IDENTITY_OVERLAP_THRESHOLD}
 *    with no equally-good rival; it keeps that flow's `id` and its scenarios
 *    re-author.
 *  - `new`, nothing prior claims it; it keeps the id it came in with.
 */
export interface GuardFlowIdentityVerdict {
  kind: 'remap' | 'stale' | 'new'
  /** The id the flow should carry: the prior flow's for `remap`/`stale`, its own for `new`. */
  id: string
}

/** {@link resolveFlowIdentity}'s outcome: a verdict per next-flow plus the orphans. */
export interface GuardFlowIdentityResolution {
  /** One verdict per entry of `next`, in the SAME order. */
  verdicts: GuardFlowIdentityVerdict[]
  /** Prior flows no re-synthesized flow claimed, orphaned (their scenarios go stale). */
  orphaned: GuardFlow[]
}

/** Milestone key → how many times the flow contains it. */
function milestoneCounts(flow: Pick<GuardFlow, 'milestones'>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const m of flow.milestones) counts.set(flowMilestoneKey(m), (counts.get(flowMilestoneKey(m)) ?? 0) + 1)
  return counts
}

function multisetSize(counts: ReadonlyMap<string, number>): number {
  let n = 0
  for (const c of counts.values()) n += c
  return n
}

/** Shared milestones between two multisets (min count per key). */
function sharedMilestones(a: ReadonlyMap<string, number>, b: ReadonlyMap<string, number>): number {
  let shared = 0
  for (const [key, count] of a) shared += Math.min(count, b.get(key) ?? 0)
  return shared
}

/**
 * Resolve re-synthesized flows against the committed ones BY MILESTONE OVERLAP,
 * never by title, titles are model-authored and reword on every re-synthesis, so
 * title identity would churn scenarios and orphan dismissals for free.
 *
 * Two passes, each claiming a prior flow at most once: an identical milestone
 * multiset remaps first (exact identity wins over any partial match); the rest take
 * their best remaining candidate when it clears
 * {@link FLOW_IDENTITY_OVERLAP_THRESHOLD} and is strictly better than the
 * runner-up (an ambiguous tie is a NEW flow, never a coin flip). Prior flows left
 * unclaimed come back as `orphaned`.
 */
export function resolveFlowIdentity(
  prev: readonly GuardFlow[],
  next: readonly GuardFlow[],
): GuardFlowIdentityResolution {
  const prevCounts = prev.map(milestoneCounts)
  const nextCounts = next.map(milestoneCounts)
  const claimedPrev = new Set<number>()
  const verdicts: GuardFlowIdentityVerdict[] = next.map((flow) => ({ kind: 'new', id: flow.id }))

  // Pass 1, exact milestone multisets remap, in `next` order.
  for (let n = 0; n < next.length; n++) {
    const counts = nextCounts[n]
    const size = multisetSize(counts)
    for (let p = 0; p < prev.length; p++) {
      if (claimedPrev.has(p)) continue
      if (multisetSize(prevCounts[p]) !== size) continue
      if (sharedMilestones(counts, prevCounts[p]) !== size) continue
      claimedPrev.add(p)
      verdicts[n] = { kind: 'remap', id: prev[p].id }
      break
    }
  }

  // Pass 2, majority overlap with a UNIQUE best candidate goes stale in place.
  for (let n = 0; n < next.length; n++) {
    if (verdicts[n].kind !== 'new') continue
    const counts = nextCounts[n]
    let best = -1
    let bestScore = 0
    let runnerUpScore = 0
    for (let p = 0; p < prev.length; p++) {
      if (claimedPrev.has(p)) continue
      const shared = sharedMilestones(counts, prevCounts[p])
      if (shared === 0) continue
      const score = shared / Math.max(multisetSize(counts), multisetSize(prevCounts[p]))
      if (score > bestScore) {
        runnerUpScore = bestScore
        bestScore = score
        best = p
      } else if (score > runnerUpScore) {
        runnerUpScore = score
      }
    }
    if (best === -1 || bestScore <= FLOW_IDENTITY_OVERLAP_THRESHOLD || bestScore === runnerUpScore) continue
    claimedPrev.add(best)
    verdicts[n] = { kind: 'stale', id: prev[best].id }
  }

  return { verdicts, orphaned: prev.filter((_, p) => !claimedPrev.has(p)) }
}
