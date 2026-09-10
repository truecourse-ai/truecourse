import { GuardCaseEvidenceSchema, caseEvidenceIssues, formatCaseEvidenceIssues, type GuardEvidenceProofContext } from '@truecourse/shared'
/**
 * THE FIDELITY JUDGE CHILD — `guard-generate.fidelity` (plan 04 step 18): a
 * depth-1 session `submit_scenario` dispatches (via `ctx.dispatchChild`) for
 * every GREEN confirmation. Fresh context IS the independence (§3.4 — same
 * model, by decision): the child sees the claims, the candidate yaml and the
 * engine's confirmation capture, and nothing of the worker's reasoning.
 *
 * Cache: name `guard/fidelity` KEPT from the one-shot stage; the key keeps the
 * one-shot structure (prompt fp :: flow fp :: sorted section keys :: scenario
 * behavior) with the child's prompt fingerprint swapped in. A hit
 * short-circuits the dispatch entirely — no child session runs. Verdicts only
 * are cached (never failures); an `unavailable` verdict is a fact about one
 * dispatch, so the next submission re-tries the child.
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import { defineSessionTool, type SessionBudget, type SessionDef, type SessionTool, type ToolContext } from '@truecourse/agent-loop'
import {
  FIDELITY_SYSTEM_PROMPT,
  type WorkerFidelityInput,
  type WorkerFidelityVerdict,
} from '@truecourse/guard-generator'
import { promptFingerprint } from '../agent/session-cache.js'
import { describeSessionFailure } from '../guard-setup/session-context.js'
import { resolveSection, type GuardDocUniverse } from './tools.js'

export const FIDELITY_SESSION_KIND = 'guard-generate.fidelity'

/** Cache name KEPT from the one-shot fidelity stage. */
export const FIDELITY_SESSION_CACHE_NAME = 'guard/fidelity'

/** The three numbers (§3.3): the briefing already carries everything — the
 *  turns cover a couple of section re-reads and the verdict. No resume: a
 *  failed child is reported `unavailable` and the green ships unreviewed
 *  (annotation, not correctness — the item-88 trade). */
export const FIDELITY_SESSION_BUDGET: SessionBudget = {
  turns: 5,
  maxResumes: 0,
  tokenCeiling: 60_000,
}

/**
 * The child's addendum to the one-shot reviewer doctrine (reused VERBATIM so
 * the bar for "verifies" cannot drift between the paths): the tool, and the
 * outcome contract replacing the one-shot JSON-reply instruction.
 */
const FIDELITY_CHILD_ADDENDUM = `

# You are a review SESSION, not a one-shot
- \`read_claim_section\` re-reads one claim's spec section precisely when the
  briefed text alone does not settle a judgment. The briefing already carries
  every section in full — most reviews need no tool call.
- The briefing also carries the CONFIRMATION CAPTURE: the engine really ran
  this scenario in a fresh sandbox just now. For a pass, judge whether it proves
  the selected claims. For a declared expected failure, judge the assertion contract
  against the spec; do not count unexecuted assertions as passing evidence.
- End the session with the outcome object (this replaces the JSON-reply
  instruction above):
    { "verdict": "faithful", "evidence": [{ "milestone": 1, "caseId": "literal-percent", "steps": [3, 4], "reason": "These assertions compare the literal-percent results with the controlled records." }] }
- When the briefing lists explicit cases, evidence is REQUIRED for each SELECTED
  case. Every cited step must itself carry the matching milestone and checks case id,
  contain an executable assertion, and use an accepted proof driver. Cite one-based
  assertion steps, not setup, contextual assertions for other cases, or bare requests. Verify the
  inputs exercise the named condition and the assertions would detect its failure.
  A milestone/check annotation alone is never proof. Omitted cases stay uncovered;
  do not reject a faithful subset for failing to test unselected cases.
- The engine validates evidence references before completion. If it returns issues,
  repair citations within this review session using the eligible tagged assertion
  indices, but only when those assertions actually prove the selected case. Never
  invent annotations or silently treat supporting context as executable proof.
  If the scenario lacks required assertions or annotations, return flagged and name
  the precise scenario change required. A missing extracted case does not broaden
  an existing selected case; judge the selected case's stated requirement.
- For negative UI assertions inspect the mapped actionable controls in the tested
  states. Do not require a proof about arbitrary future labels or unrelated pages.
  or
    { "verdict": "flagged", "mismatch": "<one sentence naming what the scenario fails to verify>", "confidence": "high" | "medium" | "low" }`

export const FIDELITY_SESSION_SYSTEM_PROMPT = FIDELITY_SYSTEM_PROMPT + FIDELITY_CHILD_ADDENDUM

/** Exported for the step-20 estimate rework (probe the REAL keys). */
export const FIDELITY_SESSION_PROMPT_FINGERPRINT = promptFingerprint(FIDELITY_SESSION_SYSTEM_PROMPT)

/** The child's outcome — the one-shot `FidelityReviewSchema` shape, made
 *  Input≡Output (no defaults) for `SessionDef.outcomeSchema`.
 *
 *  ONE object discriminated by `verdict` — deliberately NOT a
 *  `z.discriminatedUnion`: a union renders as a root-level `anyOf` JSON schema,
 *  and the drivers hand this schema to provider surfaces that require an OBJECT
 *  root (the api driver's injected `outcome` tool inputSchema, the Agent SDK
 *  driver's `outputFormat` json-schema). The pairing the union encoded is
 *  enforced by the `superRefine` instead — the loop parses every outcome before
 *  completing a session, so a `flagged` without its fields fails `malformed`
 *  there. Same recipe as guard-setup's `AuthProofOutcomeSchema`.
 *
 *  Shape-compatible with existing `guard/fidelity` cache values: a stored
 *  `{verdict: 'faithful'}` or `{verdict: 'flagged', mismatch, confidence}`
 *  carries exactly its verdict's fields, so old entries still parse as hits. */
export const FidelityVerdictSchema = z
  .object({
    verdict: z.enum(['faithful', 'flagged']),
    /** flagged: one sentence naming what the scenario fails to verify. */
    mismatch: z.string().min(1).optional(),
    /** Required with `flagged`; a faithful verdict may carry it too. */
    confidence: z.enum(['high', 'medium', 'low']).optional(),
    // Parse numeric citations before validating their range/integrality against
    // the scenario so the child can repair them through validateOutcome. The
    // persisted GuardCaseEvidenceSchema remains strict; no invalid citation can
    // complete or enter the cache when engine proof context is present.
    evidence: z.array(GuardCaseEvidenceSchema.extend({ steps: z.array(z.number()) })).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.verdict === 'flagged') {
      if (value.mismatch === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mismatch'],
          message: 'verdict "flagged" requires `mismatch`',
        })
      }
      if (value.confidence === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['confidence'],
          message: 'verdict "flagged" requires `confidence`',
        })
      }
    } else if (value.mismatch !== undefined) {
      // A faithful verdict may say how sure it is: the outcome's JSON schema
      // offers `confidence` on every verdict and cannot say otherwise, so a
      // model that fills it in is following the schema it was given. Only a
      // `mismatch` contradicts a faithful verdict.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mismatch'],
        message: 'verdict "faithful" must not carry `mismatch`',
      })
    }
  })
export type FidelityVerdict = z.infer<typeof FidelityVerdictSchema>

/**
 * The one-shot fidelity cache key's structure, kept: prompt fp :: flow fp ::
 * sorted section keys :: scenarioBehavior — with the CHILD's prompt
 * fingerprint, so editing the child prompt invalidates exactly this cache.
 */
export function fidelitySessionCacheKey(input: Pick<WorkerFidelityInput, 'flowFingerprint' | 'sectionKeys' | 'scenarioBehavior'>): string {
  return createHash('sha256')
    .update(
      [
        FIDELITY_SESSION_PROMPT_FINGERPRINT,
        input.flowFingerprint,
        [...input.sectionKeys].sort().join('~'),
        input.scenarioBehavior,
      ].join('::'),
    )
    .digest('hex')
}

/** `read_claim_section {doc, heading}` — one section of the run's doc universe. */
function readClaimSectionTool(universe: GuardDocUniverse): SessionTool {
  return defineSessionTool({
    name: 'read_claim_section',
    description:
      "Re-read one claim's spec section precisely: pass the doc ref and the section anchor (or heading) as the briefing shows them.",
    kind: 'read-claim-section',
    readOnly: true,
    destructive: false,
    inputSchema: z
      .object({
        doc: z.string().min(1).describe('The doc ref, as shown in the briefing.'),
        heading: z.string().min(1).describe('An anchor (or heading) of that doc, verbatim.'),
      })
      .strict(),
    async execute(args) {
      const doc = universe.byPath.get(args.doc)
      if (!doc) return { content: `No doc \`${args.doc}\` in this run's universe.`, isError: true }
      const section = resolveSection(doc, args.heading)
      if (!section) {
        return {
          content: `\`${args.doc}\` has no section \`${args.heading}\`. Copy an anchor from the briefing verbatim.`,
          isError: true,
        }
      }
      return { content: [`--- ${doc.doc} · ${section.anchor} ---`, section.fullText, '--- end ---'].join('\n') }
    },
  })
}

function evidenceCorrection(verdict: FidelityVerdict, context?: GuardEvidenceProofContext): string | undefined {
  if (verdict.verdict !== 'faithful') return undefined
  if (!context) {
    const parsed = z.array(GuardCaseEvidenceSchema).safeParse(verdict.evidence ?? [])
    return parsed.success ? undefined : `Invalid proof references: ${parsed.error.message}`
  }
  const issues = caseEvidenceIssues(context.milestones, context.steps, verdict.evidence)
  if (!issues.length) return undefined
  return `The faithful verdict has invalid proof references; this is an evidence-metadata repair, not a semantic rejection.\n${formatCaseEvidenceIssues(issues)}\nRecheck the selected cases and repair only the citations that the existing tagged assertions support. If eligible assertions do not prove the selected requirement, return flagged with the specific missing assertion or annotation; do not invent proof.`
}

export function fidelitySessionDef(universe: GuardDocUniverse, proofContext?: GuardEvidenceProofContext): SessionDef<FidelityVerdict> {
  const context = proofContext ? structuredClone(proofContext) : undefined
  return {
    kind: FIDELITY_SESSION_KIND,
    display: { title: 'Fidelity check' },
    systemPrompt: FIDELITY_SESSION_SYSTEM_PROMPT,
    tools: [readClaimSectionTool(universe)],
    outcomeSchema: FidelityVerdictSchema,
    validateOutcome: verdict => evidenceCorrection(verdict, context),
    budget: FIDELITY_SESSION_BUDGET,
  }
}

/** The per-kind accounting the seam reports beside the worker summary. */
export interface FidelityDispatchTally {
  ran: number
  failed: number
  allTransport: boolean
  firstError?: string
  spent: { turns: number; tokens: number; costUsd: number }
}

export function emptyFidelityTally(): FidelityDispatchTally {
  return { ran: 0, failed: 0, allTransport: true, spent: { turns: 0, tokens: 0, costUsd: 0 } }
}

/**
 * Judge one green submission: cache hit → the stored verdict (no dispatch at
 * all); miss → ONE depth-1 child session through `ctx.dispatchChild`, its
 * verdict cached on completion. A failed child (budget, malformed, transport)
 * returns `unavailable` — the engine accepts the green unreviewed and the run
 * reports it unadjudicated; nothing is cached, so the next submission (or the
 * next generate) re-tries the review for real.
 */
export async function judgeWorkerFidelity(opts: {
  repoRoot: string
  universe: GuardDocUniverse
  ctx: ToolContext
  input: WorkerFidelityInput
  tally: FidelityDispatchTally
}): Promise<WorkerFidelityVerdict> {
  const key = fidelitySessionCacheKey(opts.input)
  const cached = await getCacheEntry(opts.repoRoot, FIDELITY_SESSION_CACHE_NAME, key).catch(() => null)
  if (cached !== null) {
    const parsed = FidelityVerdictSchema.safeParse(cached)
    if (parsed.success && !evidenceCorrection(parsed.data, opts.input.proofContext)) return toWorkerVerdict(parsed.data)
  }

  opts.tally.ran++
  const outcome = await opts.ctx.dispatchChild(fidelitySessionDef(opts.universe, opts.input.proofContext), [opts.input.briefing])
  if (outcome.status === 'completed') {
    opts.tally.spent.turns += outcome.spent.turns
    opts.tally.spent.tokens += outcome.spent.tokens
    opts.tally.spent.costUsd += outcome.spent.costUsd
    // Defend the cache boundary even when a custom dispatch bypasses the loop.
    const parsed = FidelityVerdictSchema.safeParse(outcome.output)
    const defect = parsed.success ? evidenceCorrection(parsed.data, opts.input.proofContext) : `Malformed fidelity verdict: ${parsed.error.message}`
    if (!parsed.success || defect) {
      opts.tally.failed++
      opts.tally.allTransport = false
      const reason = defect ?? 'Malformed fidelity verdict'
      opts.tally.firstError ??= reason
      return { kind: 'unavailable', reason }
    }
    const verdict = parsed.data
    await setCacheEntry(opts.repoRoot, FIDELITY_SESSION_CACHE_NAME, key, verdict).catch(() => undefined)
    return toWorkerVerdict(verdict)
  }
  opts.tally.failed++
  opts.tally.spent.turns += outcome.spent.turns
  opts.tally.spent.tokens += outcome.spent.tokens
  opts.tally.spent.costUsd += outcome.spent.costUsd
  if (outcome.failure.kind !== 'transport') opts.tally.allTransport = false
  const reason = describeSessionFailure(outcome.failure)
  opts.tally.firstError ??= reason
  return { kind: 'unavailable', reason }
}

function toWorkerVerdict(verdict: FidelityVerdict): WorkerFidelityVerdict {
  // The schema's superRefine pairs `mismatch`/`confidence` with the flagged
  // verdict, and every value here came through a parse — the halves are present.
  return verdict.verdict === 'faithful'
    ? { kind: 'faithful', ...(verdict.evidence ? { evidence: verdict.evidence } : {}) }
    : { kind: 'flagged', mismatch: verdict.mismatch!, confidence: verdict.confidence! }
}
