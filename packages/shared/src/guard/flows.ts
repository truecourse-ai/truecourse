import { GuardFailureObservationSchema } from './failure-observation.js'
/**
 * Guard FLOWS — the spec-side generation unit (WHAT to test), stored in
 * `.truecourse/scenarios/flows.json` (committable, next to `manifest.json`).
 *
 * A flow is a user-goal path through the product: a title, a goal statement, an
 * ordered list of MILESTONES, and the spec-section bindings those milestones come
 * from. Every milestone references an extracted claim — synthesis may order and
 * group claims into paths, never invent an assertion — so a flow states what the
 * product should do, derived from the spec corpus alone.
 *
 * Identity is deliberately NOT the title (model-authored, unstable across
 * re-synthesis): a flow keeps its `id` through re-synthesis by its complete source obligations —
 * see {@link resolveFlowIdentity}. {@link flowFingerprint} hashes the ordered
 * milestone composition, mirroring the section fingerprint's normalize-then-sha256
 * rule so re-wrapped prose never moves it.
 */

import { GuardVerificationSchema } from './verification.js'
import crypto from 'node:crypto'
import { z } from 'zod'
import type { GuardCoverageGapKind } from './report.js'
import { GuardDriverIdSchema } from './drivers.js'

/**
 * One step of a flow's path: an extracted claim, addressed by the section it was
 * extracted under. `order` is the position in the path (1-based); `claimTitle` is
 * the extracted claim's stable text — the same identity `dismissedClaimKey` uses.
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
    /** Selected authoritative cases; omission reads the whole legacy claim. */
    caseIds: z.array(z.string().min(1)).min(1).optional(),
    /** Each listed driver can prove this entire milestone independently. Absent on legacy flows. */
    proofDrivers: z.array(GuardDriverIdSchema).min(1).optional(),
    verification: GuardVerificationSchema.optional(),
    /** Optional free-text note from synthesis (why this step sits here). */
    note: z.string().optional(),
  })
  .strict()
export type GuardFlowMilestone = z.infer<typeof GuardFlowMilestoneSchema>

/**
 * A section a flow binds to — the staleness anchor. Same triple as a scenario's
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
 * The world a flow's scenario starts from, split by HOW the state is obtained —
 * the three dependency classes, in preference order:
 *
 *  - `stepCreatable` — the public surface itself creates it, so the scenario
 *    builds it through its own steps and seeds nothing;
 *  - `seedable` — materialized deterministically before the steps (files, git
 *    history, env), travelling with the scenario;
 *  - `supplied` — real-world input the engine must never fabricate (a real
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
    /** Slugified title, `-N` disambiguated — the stable handle scenarios reference. */
    id: z.string().min(1),
    title: z.string().min(1),
    /** One-line statement of the user goal the path achieves. */
    goal: z.string().min(1),
    /** The path's kind — see {@link GuardFlowKindSchema}. */
    kind: GuardFlowKindSchema.optional(),
    /**
     * For a `variant` flow: the id of the flow whose configuration path it varies
     * (the claude-code transport vs the api transport, `llm: false` vs `true`).
     * NOT `composedOf`, which means the opposite relation — an epic chaining
     * sub-flows — and would lie about the link.
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
    /** `sha256:…` over the milestone composition — see {@link flowFingerprint}. */
    fingerprint: z.string().min(1),
    /** The path, in order. At least one milestone (an atomic flow is one claim). */
    milestones: z.array(GuardFlowMilestoneSchema).min(1),
    /** The sections the milestones come from — the flow's staleness anchors. */
    bindings: z.array(GuardFlowBindingSchema).min(1),
    /** Ids of the flows an epic flow chains (empty for a non-epic flow). */
    composedOf: z.array(z.string()).default([]),
    /** Content key over the synthesis inputs that produced this flow. */
    synthesisInputsHash: z.string().min(1),
  })
  .strict()
export type GuardFlow = z.infer<typeof GuardFlowSchema>

/**
 * A runnable claim synthesis placed in NO flow, with the reason — the coverage
 * honesty rule (every runnable claim lands in a flow or is accounted for here).
 */
export const GuardNoFlowClaimSchema = z
  .object({
    doc: z.string().min(1),
    anchor: z.string().min(1),
    claimTitle: z.string().min(1),
    /** Selected authoritative cases; omission reads the whole legacy claim. */
    caseIds: z.array(z.string().min(1)).min(1).optional(),
    reason: z.string().min(1),
  })
  .strict()
export type GuardNoFlowClaim = z.infer<typeof GuardNoFlowClaimSchema>

/**
 * The gap KIND a no-flow claim's reason states — the bridge that makes a section
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
  // "no `cli/guard` interface has been derived", "no interface exists" — the mapper
  // found nothing to step through. Word-adjacent so a passing mention of the word
  // ("interface decision `phase-0-transport`") can never match.
  if (/\bno\s+(?:\S+\s+){0,2}interface\b/i.test(text)) return 'no-interface'
  // The claim's own lead states the verdict — "blocked-on the supplied `x`
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
 * One PREDICTED red step of a submitted scenario — the flow worker's own verdict
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
    predictedActual: z.string().trim().min(1),
    observationId: z.string().min(1).optional(),
    observation: GuardFailureObservationSchema.optional(),
    /** The worker's drift verdict — `generation-defect` is deliberately absent:
     *  a worker that authored a defective scenario fixes or retires it in-loop. */
    verdict: z.enum(['doc-drift', 'code-drift']),
    /** One-paragraph plain-words assessment — the committed red's diagnosis brief. */
    brief: z.string().min(1),
  })
  .strict()
export type GuardExpectedRed = z.infer<typeof GuardExpectedRedSchema>

/** Which payload fields each outcome kind requires — the pairing the flattened
 *  schema's `superRefine` enforces (see {@link GuardFlowWorkerOutcomeSchema}). */
const FLOW_WORKER_PAYLOAD_FIELDS = {
  settled: ['scenarioYamlSha', 'expectedReds'],
  blocked: ['perMilestone'],
  'journey-defect': ['report'],
  retired: ['attempts', 'lastEvidence'],
} as const satisfies Record<string, readonly string[]>

/** Fields a kind MAY carry beyond its required payload — admitted for the kinds
 *  a worker reaches by PROBING, which volunteer what the probing showed.
 *  `blocked` came first: a worker that ends blocked after real runs attaches the
 *  evidence that proved the block, and refusing it cost a whole re-ask turn for
 *  information worth keeping (documenso 13-worker bench, 2026-08-24); `attempts`
 *  followed, after refusing it turned three honest blocked verdicts into
 *  malformed-session failures (run 6, same bench).
 *  `journey-defect` was scoped OUT of that allowance on the assumption that a
 *  defect is stated rather than probed. The first run with the web authoring arm
 *  disproved it: 83 journey-defects died malformed on these exact two fields
 *  (2026-08-26). A worker reaches `journey-defect` by TRYING the interface and
 *  watching it fail, so it reports the attempt count and the last evidence for
 *  precisely the reason a blocked one does.
 *  `settled` and `retired` stay closed: settled carries its accepted scenario,
 *  and retired REQUIRES both fields already. */
const FLOW_WORKER_OPTIONAL_FIELDS = {
  // Incremental authoring: a worker editing a flow's committed scenarios may
  // accept MORE than one (`additionalScenarios`, beyond the primary the required
  // fields carry) and may drop a prior scenario whose obligation vanished
  // (`droppedScenarios`). Both absent on a from-scratch author — the legacy
  // one-scenario shape stays byte-identical, so old cache entries still parse.
  settled: ['additionalScenarios', 'droppedScenarios'],
  blocked: ['lastEvidence', 'attempts', 'remaining'],
  'journey-defect': ['lastEvidence', 'attempts'],
  retired: ['remaining'],
} as const satisfies Record<keyof typeof FLOW_WORKER_PAYLOAD_FIELDS, readonly string[]>

/** One accepted scenario beyond the primary: its stashed sha + declared reds. */
export const GuardSettledScenarioSchema = z
  .object({
    scenarioYamlSha: z.string().min(1),
    expectedReds: z.array(GuardExpectedRedSchema),
  })
  .strict()
export type GuardSettledScenario = z.infer<typeof GuardSettledScenarioSchema>

/** A prior scenario the worker deliberately dropped, with the vanished
 *  obligation named — persisted on the manifest as a retired scenario. */
export const GuardDroppedScenarioSchema = z
  .object({
    id: z.string().min(1),
    reason: z.string().min(1),
  })
  .strict()
export type GuardDroppedScenario = z.infer<typeof GuardDroppedScenarioSchema>

/** Current reason an assigned obligation remains unfinished. Historical outcomes
 * may omit this field; new workers reconcile it against engine observations. */
export const GuardRemainingObligationSchema = z.object({
  milestone: z.number().int().positive(),
  caseId: z.string().min(1).optional(),
  reasonKind: z.enum(['assertion', 'annotation', 'preparation', 'unsupported-capability', 'review-unavailable', 'not-attempted']),
  evidence: z.string().min(1),
  issueId: z.string().min(1).optional(),
}).strict()
export type GuardRemainingObligation = z.infer<typeof GuardRemainingObligationSchema>

/**
 * The `guard-generate.flow-worker` session's outcome (plan 04 step 17) —
 * exhaustive: a worker cannot end without one of these four kinds.
 *
 * ONE object discriminated by `kind`, carrying exactly the payload fields that
 * match it — deliberately NOT a `z.discriminatedUnion`: a union renders as a
 * root-level `anyOf` JSON schema, and the drivers hand this schema to provider
 * surfaces that require an OBJECT root (the api driver's injected `outcome`
 * tool inputSchema, the Agent SDK driver's `outputFormat` json-schema). The
 * pairing the union used to encode structurally is enforced by the
 * `superRefine` — the loop parses every outcome against this schema before
 * completing a session, so a kind without its payload fails `malformed` there.
 * Same recipe as guard-setup's `AuthProofOutcomeSchema`.
 *
 * The flattening is SHAPE-COMPATIBLE with existing `guard/generate` cache
 * entries: a stored `{kind: 'settled'|'blocked', …}` object carries exactly
 * its kind's fields under the same names, so old entries still parse as hits.
 *
 * `settled` references the ENGINE-STASHED accepted scenario by the sha the
 * `submit_scenario` acceptance reported — the fold takes the yaml from the stash,
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
    /** retired: how many authoring attempts the worker spent before giving up.
     *  blocked MAY carry it too: the probe count behind the block. */
    attempts: z.number().int().nonnegative().optional(),
    /** retired: the last run's evidence — why no faithful scenario could be produced.
     *  blocked MAY carry it too: the run evidence behind the block. */
    lastEvidence: z.string().min(1).optional(),
    remaining: z.array(GuardRemainingObligationSchema).optional(),
    /** settled (edit mode): scenarios accepted beyond the primary, each by its stashed sha. */
    additionalScenarios: z.array(GuardSettledScenarioSchema).optional(),
    /** settled (edit mode): prior scenarios the worker dropped, each with the vanished obligation. */
    droppedScenarios: z.array(GuardDroppedScenarioSchema).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const wanted: readonly string[] = FLOW_WORKER_PAYLOAD_FIELDS[value.kind]
    const allowed: readonly string[] = FLOW_WORKER_OPTIONAL_FIELDS[value.kind]
    const allFields = [
      ...new Set([...Object.values(FLOW_WORKER_PAYLOAD_FIELDS).flat(), ...Object.values(FLOW_WORKER_OPTIONAL_FIELDS).flat()]),
    ]
    for (const field of allFields) {
      const present = value[field as keyof typeof value] !== undefined
      if (wanted.includes(field) && !present) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `kind "${value.kind}" requires \`${field}\``,
        })
      } else if (!wanted.includes(field) && !allowed.includes(field) && present) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `kind "${value.kind}" must not carry \`${field}\``,
        })
      }
    }
  })
export type GuardFlowWorkerOutcome = z.infer<typeof GuardFlowWorkerOutcomeSchema>

/**
 * Every scenario a `settled` outcome accepted, primary first — the one list
 * each reader walks, so a legacy one-scenario outcome and an edit-mode
 * multi-scenario one flow through the same code. Empty for any other kind.
 */
export function settledScenariosOf(outcome: GuardFlowWorkerOutcome): GuardSettledScenario[] {
  if (outcome.kind !== 'settled' || !outcome.scenarioYamlSha) return []
  return [
    { scenarioYamlSha: outcome.scenarioYamlSha, expectedReds: outcome.expectedReds ?? [] },
    ...(outcome.additionalScenarios ?? []),
  ]
}

/** `.truecourse/scenarios/flows.json` — the synthesized flow corpus. */
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
 * space and the ends are trimmed — the section-fingerprint rule, applied to the
 * milestone's identity fields, so re-wrapped claim text never moves a flow.
 */
function normalizeMilestoneText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * A milestone's identity: document, source claim and canonical selected cases. The
 * ONE key {@link flowFingerprint} hashes and {@link resolveFlowIdentity} compares,
 * so the fingerprint and the identity resolution can never disagree about what
 * makes two milestones "the same".
 */
export function flowMilestoneKey(milestone: Pick<GuardFlowMilestone, 'anchor' | 'claimTitle'> & Partial<Pick<GuardFlowMilestone, 'doc' | 'caseIds' | 'verification'>>): string {
  return `${milestone.doc ?? ''}\0${normalizeMilestoneText(milestone.anchor)}\0${normalizeMilestoneText(milestone.claimTitle)}\0${[...(milestone.caseIds ?? milestone.verification?.cases?.map(c => c.id) ?? [])].sort().join('\0')}`
}

/**
 * `sha256:<hex>` over the flow's ORDERED milestone list (each milestone's anchor +
 * claim text, normalized). Milestones are folded in `order`, so the array's
 * incidental order never matters but re-sequencing the path does — a flow's
 * fingerprint answers "did the composition of what this flow tests change?".
 */
function canonicalProofValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalProofValue)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonicalProofValue(child)]))
  return value
}

export function flowFingerprint(milestones: readonly GuardFlowMilestone[]): string {
  const ordered = [...milestones].sort((a, b) => a.order - b.order)
  const digest = crypto
    .createHash('sha256')
    .update(ordered.map((m) => flowMilestoneKey(m) + (m.proofDrivers ? `\0${[...new Set(m.proofDrivers)].sort().join(',')}` : '') + (m.verification ? `\0verification:${JSON.stringify(canonicalProofValue({ ...m.verification, ...(m.verification.cases ? { cases: [...m.verification.cases].sort((a, b) => a.id.localeCompare(b.id)) } : {}) }))}` : '')).join('\n'), 'utf-8')
    .digest('hex')
  return `sha256:${digest}`
}

/** @deprecated Compatibility export; current identity never inherits by partial overlap. */
export const FLOW_IDENTITY_OVERLAP_THRESHOLD = 0.5

/**
 * What happens to one re-synthesized flow's identity:
 *  - `remap` — its milestone multiset is identical to a prior flow's; it keeps that
 *    flow's `id` (and takes the new title).
 *  - `stale` — legacy serialized verdict, retained for reader compatibility.
 *  - `new` — nothing prior claims it; it keeps the id it came in with.
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
  /** Prior flows no re-synthesized flow claimed — orphaned (their scenarios go stale). */
  orphaned: GuardFlow[]
}

/** Preserve only one unambiguous identical complete behavior. Splits get new IDs. */
export function resolveFlowIdentity(
  prev: readonly GuardFlow[],
  next: readonly GuardFlow[],
): GuardFlowIdentityResolution {
  const claimedPrev = new Set<number>()
  const verdicts: GuardFlowIdentityVerdict[] = next.map(flow => ({ kind: 'new', id: flow.id }))
  const contract = (flow: GuardFlow) => JSON.stringify(canonicalProofValue({ fingerprint: flowFingerprint(flow.milestones), startingState: flow.startingState ?? null }))
  for (let n = 0; n < next.length; n++) {
    const key = contract(next[n])
    const matches = prev.flatMap((flow, p) => !claimedPrev.has(p) && contract(flow) === key ? [p] : [])
    // Ambiguous old identities stay orphaned; a split never inherits a parent by overlap.
    if (matches.length !== 1 || next.filter(flow => contract(flow) === key).length !== 1) continue
    claimedPrev.add(matches[0])
    verdicts[n] = { kind: 'remap', id: prev[matches[0]].id }
  }

  return { verdicts, orphaned: prev.filter((_, p) => !claimedPrev.has(p)) }
}
