/**
 * THE DOC CURATION SESSION — `spec-scan.curate-doc`, one per discovered doc.
 * It replaces the relevance + area-tag ONE-SHOTS with one
 * session that makes both judgments over the whole doc: is this spec-source
 * material for THIS repository, and which areas does it cover.
 *
 * The deterministic machinery around it did not move into the session:
 * - the prefilter and the OpenAPI bypass run BEFORE the pool — those docs get
 *   no session at all;
 * - the backstops run in the FOLD (`run.ts`): subject attribution
 *   (`applySubjectAttribution`), the alias-matcher third-party reinstatement
 *   (`namesOurProduct`), and the `parseDocStatus` header fallback. In the fold
 *   rather than the session so they also correct CACHED verdicts, forever.
 *
 * Sessions are deliberately independent of each other — no cross-session
 * context. Consistency across docs belongs to the settle-areas session
 * (step 4), which sees the whole emergent vocabulary at once.
 */

import { z } from 'zod'
import type { SessionBudget, SessionDef } from '@truecourse/agent-loop'
import {
  DocSubjectSchema,
  SkipCategorySchema,
  docBody,
  identityBlock,
  identityFingerprint,
  type DocCandidate,
  type RepoIdentity,
} from '@truecourse/spec-consolidator'
import { planDocChunks } from '@truecourse/shared'
import { promptFingerprint } from '../agent/session-cache.js'
import {
  DOC_CHUNK_CHARS,
  corpusVocabTool,
  instructionsBriefingBlock,
  listDocsTool,
  readChunkTool,
  readDocTool,
  scanCacheKey,
  type ScanDocUniverse,
} from './tools.js'

export const CURATE_DOC_SESSION_KIND = 'spec-scan.curate-doc'

/**
 * Cache name — NEW, beside the old `consolidator/relevance` +
 * `consolidator/area-tags` (whose files remain but are no longer read; the
 * step-7 estimate rework re-points the estimate here, and section 06 notes the
 * rename).
 */
export const CURATE_DOC_CACHE_NAME = 'consolidator/curate-doc'

/**
 * The three numbers. One doc is one read (the briefing carries chunk 1)
 * plus at most a couple of chunk pages or one reference lookup — five turns
 * covers that with room for one wrong guess. No resume grant: a doc that
 * cannot be judged in five turns is judged fail-open, not re-bought.
 */
export const CURATE_DOC_BUDGET: SessionBudget = {
  turns: 5,
  maxResumes: 0,
  tokenCeiling: 60_000,
}

/**
 * The session outcome. Deliberately `.strict()` and WITHOUT the one-shots'
 * `.catch(undefined)` tolerance: the loop's outcomeSchema gate re-asks on a bad
 * enum instead of silently degrading, so tolerance would only hide a model
 * drifting off the vocabulary.
 */
export const DocVerdictSchema = z
  .object({
    /** Spec-source material for this repository's corpus? */
    keep: z.boolean(),
    /** Short human-readable rationale, shown in the dashboard. */
    reason: z.string(),
    /** Whose product the doc describes, judged against the IDENTITY block. */
    subject: DocSubjectSchema.optional(),
    /** Which SKIP bullet applied, when `keep` is false. */
    category: SkipCategorySchema.optional(),
    /** The areas the doc covers — reported whether or not it is kept. */
    areas: z.array(z.object({ product: z.string().min(1), concern: z.string().min(1) })),
    /** The doc's stated lifecycle status, free-form (the fold canonicalizes). */
    status: z.string().nullish(),
  })
  .strict()
export type DocVerdict = z.infer<typeof DocVerdictSchema>

export const CURATE_DOC_SYSTEM_PROMPT = `You curate ONE documentation file for ONE repository's spec corpus. You make TWO judgments about the whole doc — whether it is spec-source material, and which AREAS it covers — then produce ONE outcome object. You never extract facts; you only judge and tag the doc.

Work IN THIS ORDER. Never merge the steps, and never start at step 2.

# STEP 1 — SUBJECT: whose product does this document describe?

The briefing opens with an IDENTITY block naming this repository's product, the other names it goes by, and what it is. Attribute the document against that block:

  this-product      — it describes the product in the IDENTITY block: its API, UI, data, events, behavior, architecture, or the decisions behind them. A doc about our own product stays this-product however much it reads like public vendor documentation — our own reference names our own product, and that is not evidence it belongs to someone else.
  different-product — it describes some OTHER product, service or system: a vendor's or competitor's API, an upstream dependency, or any invented, illustrative or unrelated product that this repository merely happens to store a document about. Its behavior is not this repository's to implement and cannot be verified against this code.
  unknown           — it names no product, or describes generic behavior, process or notes that could belong to anyone.

A different-product document is IRRELEVANT — whatever that product is, wherever the document is stored, and however well written, detailed or specification-like it is. Quality is not evidence of ownership: a polished requirements document about someone else's product is still someone else's. Decide the subject BEFORE you look at how good the content is, and do not revise it because the content impressed you.

Weigh, in this order: (1) which product the prose names and treats as its subject; (2) whether the entities, endpoints, screens, commands and rules it describes are plausibly parts of the product in the IDENTITY block, given what that block says the product IS; (3) the PATH given in the briefing — evidence, never a verdict: a location can suggest whose material a document is, but the content decides.

When the identity is genuinely unclear, answer unknown. Do not guess this-product to be safe.

# STEP 2 — CONTENT (only when the subject is this-product or unknown; a different-product doc is already decided: keep=false, category "third-party")

Does the doc state durable, intended behavior or decisions about THE SYSTEM IN THIS REPOSITORY (its endpoints, data, auth, events, invariants, business rules, architecture)?

KEEP (spec-source material):
  - PRDs, ADRs, RFCs, design proposals, spec / API docs, module-level design docs, pipeline/workflow guides
  - Any doc that states our system's contracts, behavior, or decisions — in ANY folder, including tasks/ or backlog/
  - A PRD or decision record IS spec even under a tasks/ folder (a completed one describes implemented behavior; a draft one describes planned behavior)
  - A README only if it describes what the system does / how it behaves

SKIP (not spec-source material), with the matching \`category\`:
  - status-tracking — pure status / TODO checklists, kanban boards, release notes / changelog drafts
  - superseded      — an older version of a newer doc covering the same subject
  - process         — process / meta docs not about product behavior: contribution / onboarding guides, code-style guides, deployment runbooks (keep a deployment doc ONLY if it states our runtime contracts)
  - scratch         — exploratory scratch with no committed decisions (brain dumps, open-questions-only notes)
  - agent-meta      — AI-agent instructions / prompt templates; personal engineering journals
  - third-party     — describes a DIFFERENT product than the one in the IDENTITY block (step 1's verdict)

Distinguish "states a decision about our system" (KEEP) from "tracks status / is superseded / is process" (SKIP). Those SKIP categories are explicit — they are not "doubt." WHEN GENUINELY AMBIGUOUS ABOUT THE CONTENT: keep (dropping a real spec doc costs more than keeping noise). That tie-break belongs to step 2 only — it never overturns a different-product attribution.

# STEP 3 — AREAS: tag the whole doc with the areas it covers

Report the areas WHETHER OR NOT you keep the doc — areas describe what the content covers; \`keep\` decides corpus membership, and a deterministic backstop may reinstate a doc you dropped.

An AREA is two levels: { "product", "concern" }.

PRODUCT = the separately-deployed APPLICATION / SERVICE the doc is about. CRITICAL: most repositories are ONE product — use "product": "core" for it. A feature, domain, or module name (orders, customers, billing, auth, events, payments, search) is a CONCERN, NOT a product. Only use a non-core product when the repo genuinely ships SEVERAL distinct, separately-deployed apps that reuse the same concept names — that is the only case where the product axis earns its keep. When in doubt, the product is "core".
  - WRONG: an "Orders" PRD in a single-app repo → product "orders".  (orders is a concern)
  - RIGHT: that same PRD → product "core", concerns "orders entity" / "endpoints" / "errors".

CONCERN = the slice within the product (e.g. "users entity", "auth", "events", "endpoints", "errors", "billing", "persistence", "architecture", "messaging"). Prefer a short noun phrase and reuse the same wording for the same concept across docs.

ASSIGN AT LEAST ONE AREA TO EVERY KEPT DOC. An ADR / decision record decides exactly one thing — tag the concern it decides ("we use Bearer JWTs" → core / auth; "we use Postgres" → core / persistence). Returning zero areas for a kept spec doc is a mistake — it would be excluded from contract generation entirely.

MULTI-AREA: a doc often covers several areas. List EVERY area it materially specifies — a broad doc MUST carry the concern of EVERY section that states real behavior (a substantive "## Pagination", "## Auth", "## Errors" section means that concern belongs among the tags). Ignore incidental one-line mentions. An umbrella label ("api-conventions", "platform-standards") may coexist with the specific section concerns but must NEVER REPLACE them. Cap at ~8 areas.

PROCESS BUCKET: sections that are pure overview / goals / non-goals / open-questions and spec no behavior map to product "process" with one of these concerns: overview, goals, non-goals, open-questions. A doc that is ONLY process gets only process areas; a substantive doc that merely has a Goals section does NOT need a process area.

STATUS: if the doc header states a lifecycle (Status: shipped / planned / deferred / deprecated / out-of-scope, or equivalents like "done"/"draft"), report it verbatim in \`status\`; otherwise null.

# Tools — when to use them

The briefing carries your doc (its first chunk; \`read_chunk\` pages the rest). Beyond your own doc:
- \`read_doc\` — open ANOTHER doc ONLY to resolve an explicit reference or deferral your doc makes ("see docs/auth.md", "superseded by plan-v3") — never to browse the repository.
- \`corpus_vocab\` — call it BEFORE minting a product or concern label: if a label already in use names the same thing, reuse that exact wording instead of a synonym.
- \`list_docs\` — resolve a referenced doc whose exact path you do not know.

# The outcome

One object: { "keep": true|false, "reason": "short explanation", "subject": "this-product"|"different-product"|"unknown", "category": "<a SKIP category, only when keep is false>", "areas": [ { "product": "core", "concern": "orders entity" } ], "status": "shipped" | null }

"subject" is always reported. When it is "different-product", "keep" MUST be false and "category" MUST be "third-party". "category" is REQUIRED when keep is false and OMITTED when keep is true. The reason is shown to the user in the dashboard — be specific ("describes a different product (ServiceTitan)", "superseded by capacity-ml-plan-v3") so they can verify the call.`

/** The prompt half of every curate-doc cache key — exported for the step-7
 *  estimate rework, which must probe the REAL keys. */
export const CURATE_DOC_PROMPT_FINGERPRINT = promptFingerprint(CURATE_DOC_SYSTEM_PROMPT)

/**
 * The cache key: prompt fingerprint :: identity fingerprint :: path :: content
 * hash. Tool results are deliberately OUTSIDE the key — they are how the
 * session reads inputs the key already names. `extraParts` is the appendable
 * tail (step 6's orchestrator `instructions` land there later).
 */
export function curateDocCacheKey(
  input: { identity: RepoIdentity | null; doc: Pick<DocCandidate, 'path' | 'contentHash'> },
  extraParts: readonly string[] = [],
): string {
  return scanCacheKey([
    CURATE_DOC_PROMPT_FINGERPRINT,
    identityFingerprint(input.identity),
    input.doc.path,
    input.doc.contentHash,
    ...extraParts,
  ])
}

export interface CurateDocSessionInput {
  doc: DocCandidate
  universe: ScanDocUniverse
  /** The labels the run has folded so far — what `corpus_vocab` answers with. */
  liveVocab: () => { products: readonly string[]; concerns: readonly string[] }
}

export function curateDocSessionDef(input: CurateDocSessionInput): SessionDef<DocVerdict> {
  return {
    kind: CURATE_DOC_SESSION_KIND,
    systemPrompt: CURATE_DOC_SYSTEM_PROMPT,
    tools: [
      readChunkTool(input.doc),
      readDocTool(input.universe),
      corpusVocabTool(input.liveVocab),
      listDocsTool(input.universe),
    ],
    outcomeSchema: DocVerdictSchema,
    budget: CURATE_DOC_BUDGET,
  }
}

/** The work item, as the session index and the transcript record it. */
export function curateDocWorkItem(docPath: string): string {
  return `doc:${docPath}`
}

/**
 * The opening message: the identity block (per-run DATA, so it rides the user
 * message and the system prompt stays one fingerprint), the orchestrator's
 * standing instructions (step 6 — they also enter the cache key, via the
 * `extraParts` tail at the call site), the doc's coordinates, and the doc
 * body's first chunk.
 */
export function curateDocBriefing(
  doc: DocCandidate,
  identity: RepoIdentity | null,
  instructions: readonly string[] = [],
): string {
  const chunks = planDocChunks(doc.path, docBody(doc), DOC_CHUNK_CHARS)
  const first = chunks[0]
  const lines = [
    ...instructionsBriefingBlock(instructions),
    identityBlock(identity),
    `PATH (repo-relative): ${doc.path}`,
    `Detected kind: ${doc.kind}`,
    `Size: ${doc.size} bytes`,
    '',
    chunks.length > 1 ? `--- doc (chunk 1/${chunks.length}) ---` : '--- doc ---',
    first?.text ?? '',
    '--- end doc ---',
  ]
  if (chunks.length > 1) {
    lines.push('', `${chunks.length - 1} more chunk(s) — use \`read_chunk\` to page through the rest.`)
  }
  lines.push('', 'Attribute the subject first, then judge the content, then tag the areas. Produce the outcome object.')
  return lines.join('\n')
}
