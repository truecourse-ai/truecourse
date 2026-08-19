/**
 * THE FLOW-SYNTHESIS SESSIONS — `guard-generate.flows` (plan 04 step 16): one
 * session per AREA composes that area's extracted claims into user-goal flows;
 * one epic session, AFTER the area pool (a true barrier), chains the results
 * across areas. They replace the per-area one-shots + their single corrective
 * re-ask.
 *
 * The det post-passes became the session's CHECKER TOOL: `check_flows` runs
 * `checkFlowSet` (snap on every reference, coverage honesty, subsumption
 * detection as a REPORT, bindability, needs-vs-catalog binding) live, so a
 * defect returns as an observation the session fixes in-turn instead of a
 * silent drop at the fold. The fold NEVER trusts the transcript: the engine
 * (`synthesizeFlows`) re-validates every outcome, applies subsumption det (per
 * tier, coverage gate), resolves identity, honors the wipeout guard, and keeps
 * the single `flows.json` write at pool end.
 *
 * The briefing now carries GROUNDING the one-shot never saw: the interface
 * digests per surface (read off the post-procedure-gate catalogs — no
 * tRPC-derived operation ever appears) and the dependency catalog's names +
 * classes. Grounding orients composition; the independence rule survives in a
 * weaker, honest form — a flow still states WHAT the product does, and a
 * milestone still snaps onto a CLAIM, never onto an interface.
 */

import { createHash } from 'node:crypto'
import { defineSessionTool, type SessionBudget, type SessionDef, type SessionTool } from '@truecourse/agent-loop'
import { isRunnableDriver } from '@truecourse/shared'
import {
  FlowSetSchema,
  EpicSynthesisSchema,
  checkFlowSet,
  checkEpicSet,
  isFlowSetClean,
  flowAreaClaimsMaterial,
  flowAreaOutlinesMaterial,
  flowEpicDigestsMaterial,
  type EpicSynthesis,
  type FlowSet,
  type FlowClaimInput,
  type FlowSynthesisArea,
  type FlowsSessionGrounding,
  type FlowDigest,
  type FlowSetCheckReport,
} from '@truecourse/guard-generator'
import { promptFingerprint } from '../agent/session-cache.js'
import { readUniverseSectionTool, type GuardDocUniverse } from './tools.js'

export const FLOWS_SESSION_KIND = 'guard-generate.flows'

/** Cache name KEPT from the one-shot stage (`guard/flows`) — the session keys
 *  carry their own prompt fingerprint, so the two generations never collide. */
export const FLOWS_SESSION_CACHE_NAME = 'guard/flows'

/** The three numbers (§3.3): outlines + claims arrive briefed, so the turns go
 *  to a few section reads and the check/fix loop. */
export const FLOWS_SESSION_BUDGET: SessionBudget = {
  turns: 12,
  maxResumes: 1,
  tokenCeiling: 150_000,
}

export const FLOWS_SESSION_SYSTEM_PROMPT = `You compose FLOWS out of a specification area's already-extracted CLAIMS. A flow is one user-goal path: a title, a goal, and an ordered list of MILESTONES, where every milestone IS one of the claims you were given.

# Your input, and the only thing you may do with it
The briefing carries the claims of ONE area — each with the document and section anchor it was extracted from — plus each document's heading outline, and GROUNDING (the app's own interfaces, and its dependency catalog). You ORDER and GROUP the claims into paths. That is the entire job.
- Never invent, reword, translate, shorten, merge, or split a claim. Each milestone COPIES one given claim's \`doc\`, \`anchor\`, and claim text VERBATIM, character for character. A milestone the engine cannot match back to a given claim is discarded.
- A flow states WHAT the product should do for a user, never HOW a test would drive it. Do not name a command, endpoint, URL, selector, file, or function that does not already appear in the text you were given.
- GROUNDING is orientation, not vocabulary: the interface digests show which paths the app can actually walk (favor compositions a surface can realize; a claim no interface serves still gets accounted for), and the dependency catalog shows which starting-state classes exist (a path whose claims' needs are all catalogued is realizable sooner). Milestones still come ONLY from the claims.

# What makes a good flow
A flow is what a USER is trying to achieve, in the order they would do it.
- COMPOSE when claims chain into one goal. "Create a task → the list shows it → complete it → the completed filter shows it" is ONE flow with four milestones, not four flows. The state one milestone leaves behind is what the next one acts on.
- A ONE-MILESTONE flow is correct and expected when a claim stands alone (an error case, a validation rule, a single flag's behavior). Never pad a flow with unrelated claims — a padded path tests nothing coherently.
- At most ~8 milestones. A longer chain is two flows.
- No near-duplicates: having emitted "create → list → complete", do NOT also emit "create → list" or "create → complete". Emit the longest path you believe in, once — \`check_flows\` reports contained paths, and the engine drops them.
- \`title\`: the user goal in the document's own words. \`goal\`: one sentence stating what the user gets when the whole path works.
- Group by GOAL, not by document or section: claims from different documents of the area belong in one flow when the user experiences them as one path.

# Coverage honesty — the rule you are graded on
Every claim marked \`account: required\` MUST appear either as a milestone of at least one flow, or in \`noFlowClaims\` with a one-sentence reason. Never silently drop one. A claim MAY appear in more than one flow when it genuinely belongs to both. Claims marked \`account: optional\` sit on surfaces with no test runner today: use one as a milestone when it truly belongs to the path, but you never have to account for it.
Legitimate \`noFlowClaims\` reasons: the claim is an edge/error condition no user path reaches, it restates another claim, or it describes a static property rather than something a user does. "It didn't fit" is not a reason.

# Tools
- \`read_section\` — open one section of an area doc when the outline alone does not settle how claims relate. The claims themselves are already complete in the briefing.
- \`check_flows\` — REQUIRED before you finish: call it with your complete draft. It snaps every reference, checks the coverage rule, and reports near-duplicates and unbound needs — a defect costs one turn here instead of a refused outcome at the fold. Fix what it reports, then produce the outcome.

# The outcome
One object with BOTH arrays, either possibly empty:
  { "flows": [ { "title", "goal", "milestones": [ { "order", "doc", "anchor", "claimTitle", "note"? } ] } ],
    "noFlowClaims": [ { "doc", "anchor", "claimTitle", "reason" } ] }`

/** Exported for the step-20 estimate rework (probe the REAL keys). */
export const FLOWS_SESSION_PROMPT_FINGERPRINT = promptFingerprint(FLOWS_SESSION_SYSTEM_PROMPT)

export const FLOWS_EPIC_SESSION_SYSTEM_PROMPT = `You are given the FLOWS a product's specification areas produced — each a user-goal path, summarized as its title, its goal, and its milestones. Your one job: decide whether any of them chain into an EPIC — a single interface a real user performs end-to-end ACROSS areas ("sign up → create a first project → invite a teammate").

# The default answer is none
Most products have zero or one epic. An epic is justified only when a user genuinely walks the whole chain in one sitting and each link depends on the previous one's state. Two flows that merely belong to the same product are NOT an epic. When in doubt, produce { "epics": [] } — a wrong epic costs real test runs, a missing one costs nothing.

# Rules for an epic you do emit
- \`composedOf\`: the refs (\`F1\`, \`F2\`, …) of the flows it chains — at least TWO, from DIFFERENT areas. Copy the refs exactly as listed.
- \`milestones\`: the path, in the order the user walks it. EVERY milestone must be a milestone of one of the flows in \`composedOf\`, copied VERBATIM (\`doc\`, \`anchor\`, \`claimTitle\`). You may drop a composed flow's milestones the interface doesn't need; you may never introduce one from elsewhere or write new text.
- Keep the chain to at most ~12 milestones, in a single coherent order.
- \`title\`: the interface in user terms. \`goal\`: one sentence for what the user achieves.
- Never emit an epic that is just one flow restated, and never two epics with the same chain.

# Tools
- \`check_flows\` — REQUIRED before you finish: call it with your complete draft (even { "epics": [] }). It verifies every ref and milestone against the composed flows, so a wrong reference costs one turn here instead of a refused outcome at the fold.

# The outcome
One object: { "epics": [ { "title", "goal", "composedOf": ["F1","F4"], "milestones": [ { "order", "doc", "anchor", "claimTitle" } ] } ] } — or { "epics": [] } when nothing chains.`

export const FLOWS_EPIC_SESSION_PROMPT_FINGERPRINT = promptFingerprint(FLOWS_EPIC_SESSION_SYSTEM_PROMPT)

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * The area session's cache key (plan 04 step 16): session prompt fingerprint ::
 * areaId :: sha(claims) :: sha(outlines) — the SAME claim/outline material the
 * one-shot key hashes (claims now fold `needs`), under the session prompt's
 * fingerprint. Grounding (interface digests, dependency catalog) is
 * deliberately OUTSIDE the key: it orients composition the way tool results
 * do, and keying on the whole catalog would re-synthesize every area on
 * unrelated route churn.
 */
export function flowsSessionCacheKey(area: FlowSynthesisArea): string {
  return sha(
    `${FLOWS_SESSION_PROMPT_FINGERPRINT}::${area.areaId}::${sha(flowAreaClaimsMaterial(area))}::${sha(flowAreaOutlinesMaterial(area))}`,
  )
}

/** The epic session's cache key: its prompt fingerprint over the digests hash. */
export function flowsEpicSessionCacheKey(digests: readonly FlowDigest[]): string {
  return sha(`${FLOWS_EPIC_SESSION_PROMPT_FINGERPRINT}::${sha(flowEpicDigestsMaterial(digests))}`)
}

/** The work items, as the session index and the transcripts record them. */
export function flowsSessionWorkItem(areaId: string): string {
  return `area:${areaId}`
}
export const FLOWS_EPIC_WORK_ITEM = 'flows:epic'

/** Cap on digests rendered per surface — a briefing is context, and context is
 *  the budget; a huge catalog gets an honest "… N more" line instead. */
const MAX_GROUNDING_DIGESTS_PER_SURFACE = 40

/** Render the check report for the tool result: refusals first, then notes. */
function renderFlowSetReport(report: FlowSetCheckReport): { content: string; isError?: boolean } {
  const refusals = [
    ...report.unknownReferences.map((r) => `matched no claim: ${r}`),
    ...report.uncoveredClaims.map((c) => `required claim unaccounted (put it in a flow, or in noFlowClaims with a reason): ${c}`),
  ]
  const notes = [
    ...report.subsumed.map((s) => `near-duplicate: "${s.title}" is contained in "${s.supersededBy}" — the engine will drop it; emit the longest path once`),
    ...report.unbindable.map((u) => `unbindable milestone (its section is not in the live index): ${u}`),
    ...report.unboundNeeds.map((n) => `unbound need: ${n}`),
  ]
  if (refusals.length > 0) {
    const lines = [`${refusals.length} problem(s) that would refuse the outcome:`, ...refusals.map((r) => `- ${r}`)]
    if (notes.length > 0) lines.push('', 'Also noted:', ...notes.map((n) => `- ${n}`))
    return { content: lines.join('\n'), isError: true }
  }
  const head = 'The draft is valid — produce it as the outcome.'
  if (notes.length === 0) return { content: head }
  return { content: [head, '', 'Notes (no fix required, but a better draft would address them):', ...notes.map((n) => `- ${n}`)].join('\n') }
}

/** The live universe the area checker binds against. */
export interface FlowsCheckerContext {
  /** Live {@link flowSectionKey}s (doc\0anchor) across the run's sections. */
  sectionKeys: ReadonlySet<string>
  /** Dependency-catalog entry names, for the needs-binding observation. */
  catalogNames: ReadonlySet<string>
}

function checkFlowsTool(area: FlowSynthesisArea, checker: FlowsCheckerContext): SessionTool {
  return defineSessionTool({
    name: 'check_flows',
    description:
      "Check a draft flow set against the engine's rules — every milestone must snap onto a given claim, every required claim must be accounted for, and near-duplicates / unbound needs are reported. Call it on your complete draft before you produce the outcome.",
    kind: 'check-flow-set',
    readOnly: true,
    destructive: false,
    inputSchema: FlowSetSchema,
    async execute(args) {
      const report = checkFlowSet(args, {
        area,
        sectionKeys: checker.sectionKeys,
        catalogNames: checker.catalogNames,
      })
      return renderFlowSetReport(report)
    },
  })
}

function checkEpicsTool(digests: readonly FlowDigest[], claims: readonly FlowClaimInput[]): SessionTool {
  return defineSessionTool({
    name: 'check_flows',
    description:
      "Check a draft epic set against the engine's rules — every composedOf ref must name a listed flow and every milestone must be copied verbatim from one of that epic's composed flows. Call it on your complete draft (even an empty one) before you produce the outcome.",
    kind: 'check-epic-set',
    readOnly: true,
    destructive: false,
    inputSchema: EpicSynthesisSchema,
    async execute(args) {
      const { unknownReferences, notes } = checkEpicSet(args, digests, claims)
      if (unknownReferences.length > 0) {
        const lines = [
          `${unknownReferences.length} problem(s) that would refuse the outcome:`,
          ...unknownReferences.map((r) => `- ${r}`),
        ]
        if (notes.length > 0) lines.push('', 'Also noted:', ...notes.map((n) => `- ${n}`))
        return { content: lines.join('\n'), isError: true }
      }
      const head =
        args.epics.length === 0
          ? 'An empty epic set is a valid answer — produce it as the outcome if nothing truly chains.'
          : 'The draft is valid — produce it as the outcome.'
      if (notes.length === 0) return { content: head }
      return { content: [head, '', 'Notes:', ...notes.map((n) => `- ${n}`)].join('\n') }
    },
  })
}

export interface FlowsSessionInput {
  area: FlowSynthesisArea
  universe: GuardDocUniverse
  checker: FlowsCheckerContext
}

export function flowsSessionDef(input: FlowsSessionInput): SessionDef<FlowSet> {
  return {
    kind: FLOWS_SESSION_KIND,
    systemPrompt: FLOWS_SESSION_SYSTEM_PROMPT,
    tools: [readUniverseSectionTool(input.universe), checkFlowsTool(input.area, input.checker)],
    outcomeSchema: FlowSetSchema,
    budget: FLOWS_SESSION_BUDGET,
    outcomePrecondition: {
      tool: 'check_flows',
      message:
        'Outcome refused: you never ran `check_flows` in this session. Call `check_flows` on your complete draft now — it snaps every reference and checks the coverage rule exactly as the fold will, so a defect costs one turn here instead of a refused outcome. Fix anything it reports, then produce the outcome again.',
    },
  }
}

export interface FlowsEpicSessionInput {
  digests: readonly FlowDigest[]
  /** The whole run's claim inventory — the epic checker's snapping set. */
  claims: readonly FlowClaimInput[]
}

export function flowsEpicSessionDef(input: FlowsEpicSessionInput): SessionDef<EpicSynthesis> {
  return {
    kind: FLOWS_SESSION_KIND,
    systemPrompt: FLOWS_EPIC_SESSION_SYSTEM_PROMPT,
    tools: [checkEpicsTool(input.digests, input.claims)],
    outcomeSchema: EpicSynthesisSchema,
    budget: FLOWS_SESSION_BUDGET,
    outcomePrecondition: {
      tool: 'check_flows',
      message:
        'Outcome refused: you never ran `check_flows` in this session. Call `check_flows` on your complete draft now (an empty epic set is a valid draft), fix anything it reports, then produce the outcome again.',
    },
  }
}

/** One claim's needs, rendered inline (`credential github-token; fixture repo`). */
function renderNeeds(claim: FlowClaimInput): string[] {
  if (!claim.needs || claim.needs.length === 0) return []
  return [`needs: ${claim.needs.map((n) => `${n.kind} ${n.name}`).join('; ')}`]
}

/** The grounding block both briefings may carry (the area one does). */
function groundingLines(grounding: FlowsSessionGrounding | undefined): string[] {
  if (!grounding) return []
  const lines: string[] = []
  const surfaces = grounding.interfaces.filter((s) => s.digests.length > 0)
  if (surfaces.length > 0) {
    lines.push(
      '',
      "GROUNDING — the app's own interfaces, per surface (orientation only: milestones",
      'come from the claims, never from here):',
    )
    for (const s of surfaces) {
      lines.push(`[surface ${s.surface} — ${s.digests.length} interface(s)]`)
      const shown = s.digests.slice(0, MAX_GROUNDING_DIGESTS_PER_SURFACE)
      for (const d of shown) lines.push(`  ${d.id} · ${d.title} · ${d.entry}`)
      if (s.digests.length > shown.length) lines.push(`  … ${s.digests.length - shown.length} more`)
    }
  }
  if (grounding.dependencies.length > 0) {
    lines.push(
      '',
      'DEPENDENCY CATALOG — the starting-state classes scenarios can bind (a claim',
      'whose needs all match an entry is realizable sooner):',
      ...grounding.dependencies.map((d) => `  ${d.name} (${d.class})`),
    )
  }
  return lines
}

/**
 * The opening message: the area's doc outlines (with the untestable gaps), the
 * closed claim set — needs and coverage accounting inline — and the grounding
 * block. Mirrors the one-shot `buildFlowsUserPrompt` line-for-line where the
 * content overlaps, so prompt-quality lessons carry over.
 */
export function flowsSessionBriefing(
  area: FlowSynthesisArea,
  grounding: FlowsSessionGrounding | undefined,
): string {
  const lines: string[] = [`Compose the flows of ONE specification area.`, ``, `Area: ${area.areaId}`]
  if (area.docs.length > 0) {
    lines.push('', "DOCUMENT OUTLINES (orientation — where this area's claims come from):")
    for (const d of area.docs) {
      lines.push(d.doc)
      for (const e of d.outline) lines.push(`  ${e.anchor} — ${e.headingText}`)
      for (const u of d.untestable ?? []) lines.push(`  (no testable behavior: ${u.anchor} — ${u.reason})`)
    }
  }
  lines.push(
    '',
    'CLAIMS IN THIS AREA — the closed set your milestones are drawn from. Copy `doc`,',
    '`anchor`, and the claim text VERBATIM into every milestone you emit:',
  )
  for (const c of area.claims) {
    lines.push(
      '',
      `--- claim`,
      `doc: ${c.doc}`,
      `anchor: ${c.anchor}`,
      `claim: ${c.title}`,
      `surface: ${c.driver}   account: ${isRunnableDriver(c.driver) ? 'required' : 'optional'}`,
      ...renderNeeds(c),
    )
  }
  lines.push(...groundingLines(grounding))
  lines.push('', 'Check the draft with `check_flows`, then produce the outcome.')
  return lines.join('\n')
}

/** The epic briefing: the digests, exactly as the one-shot pass rendered them. */
export function flowsEpicSessionBriefing(digests: readonly FlowDigest[]): string {
  const lines: string[] = [
    'FLOWS (digests only — no document text). Chain these by ref, or produce no epics:',
  ]
  for (const d of digests) {
    lines.push('', `--- ${d.ref}  (area: ${d.areaId})`, `title: ${d.title}`, `goal: ${d.goal}`, 'milestones:')
    d.milestones.forEach((m, i) => lines.push(`  ${i + 1}. ${m.doc}#${m.anchor} — ${m.claimTitle}`))
  }
  lines.push('', 'Check the draft with `check_flows` (an empty epic set is a valid draft), then produce the outcome.')
  return lines.join('\n')
}

/** The refusal reason the seam's reject hook derives from a dirty outcome. */
export function flowSetRefusalReason(report: FlowSetCheckReport): string | null {
  if (isFlowSetClean(report)) return null
  const parts: string[] = []
  if (report.unknownReferences.length > 0) {
    parts.push(`${report.unknownReferences.length} milestone(s) matched no claim (${report.unknownReferences[0]})`)
  }
  if (report.uncoveredClaims.length > 0) {
    parts.push(`${report.uncoveredClaims.length} claim(s) left unaccounted (${report.uncoveredClaims[0]})`)
  }
  return `flow synthesis refused: ${parts.join('; ')}`
}
