/**
 * THE AREA SETTLING SESSION — `spec-scan.settle-areas`, AT MOST ONE per corpus
 * (plan 02 step 4). It replaces the vocab-normalizer one-shot with more
 * authority: besides merging drifted labels it may COLLAPSE a product to core
 * (the one merge the old sanitize forbade — legal here, on this path only,
 * because the session justifies every non-core product or collapses it) and
 * SUBDIVIDE an oversized concern into finer ones, assigning every doc.
 *
 * It runs AFTER the whole curation pool (a true barrier — its input is the
 * complete emergent vocabulary), at concurrency 1. A deterministic GATE spends
 * zero sessions on the common case: one core product, few concerns, nothing
 * oversized.
 */

import { z } from 'zod'
import { defineSessionTool, type SessionBudget, type SessionDef, type SessionTool } from '@truecourse/agent-loop'
import {
  CORE_PRODUCT,
  PROCESS_PRODUCT,
  normalizeArea,
  splitArea,
  type AreaTag,
  type VocabMap,
} from '@truecourse/spec-consolidator'
import { promptFingerprint } from '../agent/session-cache.js'
import {
  docsWithLabelTool,
  instructionsBriefingBlock,
  readDocTool,
  scanCacheKey,
  type ScanDocUniverse,
} from './tools.js'

export const SETTLE_AREAS_SESSION_KIND = 'spec-scan.settle-areas'
export const SETTLE_AREAS_CACHE_NAME = 'consolidator/settle-areas'

/** A concern carrying more docs than this is flagged as a subdivision candidate. */
export const SUBDIVISION_DOC_THRESHOLD = 40

/**
 * The three numbers (§3.3): the settlement is a read-a-few-samples-and-decide
 * job — eight turns covers the label listings plus a handful of doc reads, and
 * one resume grant covers a corpus whose vocabulary genuinely needs the tour.
 */
export const SETTLE_AREAS_BUDGET: SessionBudget = {
  turns: 8,
  maxResumes: 1,
  tokenCeiling: 100_000,
}

// Every field REQUIRED (empty containers are fine) — a `.default()` would give
// the schema a different input than output type, which `SessionDef`'s
// `z.ZodType<TOutcome>` deliberately refuses, and a session should state "no
// merges" explicitly rather than by omission anyway.
export const AreaSettlementSchema = z
  .object({
    /** drifted concern label → canonical concern label (both from the briefing). */
    concernMerges: z.record(z.string(), z.string()),
    /** drifted product label → canonical product label, or "core" (to-core is LEGAL here). */
    productMerges: z.record(z.string(), z.string()),
    /** One verdict REQUIRED per non-core product: does the product axis earn its keep? */
    productVerdicts: z.array(
      z.object({
        product: z.string().min(1),
        verdict: z.enum(['justified', 'collapse-to-core']),
        reason: z.string(),
      }),
    ),
    /** Oversized concerns split into finer ones; EVERY doc of the label assigned. */
    subdivisions: z.array(
      z.object({
        label: z.string().min(1),
        into: z.array(z.string().min(1)).min(2),
        /** doc ref → the member of `into` it belongs to. Complete over the label's docs. */
        assignments: z.record(z.string(), z.string()),
      }),
    ),
  })
  .strict()
export type AreaSettlement = z.infer<typeof AreaSettlementSchema>

/**
 * The emergent vocabulary as the gate, the briefing, the tools and the
 * validator all see it — ONE derivation so they cannot disagree. Labels are
 * canonical slugs (post `normalizeArea`); `core`/`process` are excluded from
 * the product axis and process concerns from the concern axis, exactly as the
 * old vocab-normalizer collected them.
 */
export interface AreaVocabView {
  /** Non-core products → doc refs carrying them. */
  products: Map<string, string[]>
  /** Concerns → doc refs carrying them. */
  concerns: Map<string, string[]>
  /** Concerns whose doc count exceeds {@link SUBDIVISION_DOC_THRESHOLD}. */
  overThreshold: string[]
}

/** Canonicalize one doc's raw tags exactly as the grouper will. */
export function canonicalDocTags(tags: readonly AreaTag[]): AreaTag[] {
  const ids = new Set<string>()
  for (const tag of tags) {
    const id = normalizeArea(tag)
    if (id) ids.add(id)
  }
  return [...ids].sort().map((id) => splitArea(id))
}

export function collectAreaVocab(tagsByPath: ReadonlyMap<string, readonly AreaTag[]>): AreaVocabView {
  const products = new Map<string, string[]>()
  const concerns = new Map<string, string[]>()
  const push = (map: Map<string, string[]>, key: string, ref: string): void => {
    const list = map.get(key)
    if (list) {
      if (!list.includes(ref)) list.push(ref)
    } else map.set(key, [ref])
  }
  for (const [ref, tags] of tagsByPath) {
    for (const tag of canonicalDocTags(tags)) {
      if (tag.product !== CORE_PRODUCT && tag.product !== PROCESS_PRODUCT) push(products, tag.product, ref)
      if (tag.product !== PROCESS_PRODUCT) push(concerns, tag.concern, ref)
    }
  }
  const overThreshold = [...concerns.entries()]
    .filter(([, refs]) => refs.length > SUBDIVISION_DOC_THRESHOLD)
    .map(([label]) => label)
    .sort()
  return { products, concerns, overThreshold }
}

/**
 * The deterministic gate: a session runs only when there is something to
 * settle — ≥2 values on either axis, OR any product outside {core, process}
 * (the reference regression: a single-axis single-product corpus with ONE
 * non-core product still sessions, because that product needs its verdict),
 * OR any concern past the subdivision threshold.
 */
export function settleAreasGate(vocab: AreaVocabView): boolean {
  return vocab.products.size >= 1 || vocab.concerns.size >= 2 || vocab.overThreshold.length > 0
}

export const SETTLE_AREAS_SYSTEM_PROMPT = `You settle the AREA VOCABULARY that emerged from curating ONE repository's docs. Each doc was tagged independently, so the same thing may appear under different names, a feature may masquerade as a product, and a broad concern may have swallowed too many docs. You have the WHOLE vocabulary in front of you; your settlement is applied before the docs are grouped into areas.

You decide FOUR things:

1. CONCERN MERGES — cluster concern labels that mean the SAME thing and map every non-canonical one to the canonical one ("authentication" → "auth"; "appointment" → "appointments"). Canonical targets MUST be labels from the briefing; never invent a merge target. Prefer the shortest / plainest member. When in doubt, DO NOT merge — a wrong merge is worse than a near-duplicate.

2. PRODUCT MERGES — the same, on the product axis ("booking-app" → "booking"). Here one extra target is legal: "core". Mapping a product to core says it never was a separate product — its docs describe the one system, and its concerns join core's.

3. PRODUCT VERDICTS — for EVERY non-core product in the briefing, one verdict:
   - "justified"        — the repo genuinely ships this as a distinct, separately-deployed app/service, and keeping its concerns apart from same-named core concerns earns the axis its keep.
   - "collapse-to-core" — it is a feature, module or domain wearing a product name; its docs belong to core. (Equivalent to a product merge onto core — state it either way, but state it.)
   Judge from the docs: \`docs_with_label\` lists a label's docs, \`read_doc\` opens one. A repository is usually ONE product — the default lean is collapse.

4. SUBDIVISIONS — a concern flagged as oversized in the briefing may be split into 2+ finer concerns. If you subdivide, you MUST assign EVERY doc of that label to exactly one of the new concerns — an unassigned doc is a validation error. Subdivide only when the label genuinely bundles distinct slices (an "api" label holding auth + billing + webhooks); a large-but-coherent label stays whole. The new concerns become ordinary areas.

VALIDATE BEFORE YOU FINISH: call \`check_settlement\` with your complete draft. It runs the exact checks the run applies — missing product verdicts, merge targets not in the briefing, incomplete subdivision assignments — and a problem it finds costs one turn here instead of your whole settlement at the outcome.

The outcome is one object: { "concernMerges": {...}, "productMerges": {...}, "productVerdicts": [...], "subdivisions": [...] }. Empty containers are fine — an already-settled vocabulary is a normal outcome.`

/** Exported for the step-7 estimate rework (probe the REAL keys). */
export const SETTLE_AREAS_PROMPT_FINGERPRINT = promptFingerprint(SETTLE_AREAS_SYSTEM_PROMPT)

/**
 * The cache key: label SETS only, deliberately — a doc edit that moves no
 * label is a hit. `extraParts` is the appendable tail (step 6's orchestrator
 * `instructions` land there later).
 */
export function settleAreasCacheKey(vocab: AreaVocabView, extraParts: readonly string[] = []): string {
  return scanCacheKey([
    SETTLE_AREAS_PROMPT_FINGERPRINT,
    [...vocab.products.keys()].sort().join(','),
    [...vocab.concerns.keys()].sort().join(','),
    [...vocab.overThreshold].sort().join(','),
    ...extraParts,
  ])
}

/**
 * The validation `check_settlement` runs in-session and the fold re-runs on
 * the outcome (never trust the transcript). Returns problems; empty = valid.
 */
export function validateSettlement(settlement: AreaSettlement, vocab: AreaVocabView): string[] {
  const errors: string[] = []
  const products = new Set(vocab.products.keys())
  const concerns = new Set(vocab.concerns.keys())

  for (const [from, to] of Object.entries(settlement.concernMerges)) {
    if (!concerns.has(from)) errors.push(`concernMerges: \`${from}\` is not a concern label of this corpus`)
    else if (!concerns.has(to)) errors.push(`concernMerges: target \`${to}\` is not a concern label of this corpus`)
    else if (from === to) errors.push(`concernMerges: \`${from}\` maps to itself`)
  }
  for (const [from, to] of Object.entries(settlement.productMerges)) {
    if (!products.has(from)) errors.push(`productMerges: \`${from}\` is not a non-core product of this corpus`)
    else if (to !== CORE_PRODUCT && !products.has(to)) {
      errors.push(`productMerges: target \`${to}\` is neither a product of this corpus nor \`core\``)
    } else if (from === to) errors.push(`productMerges: \`${from}\` maps to itself`)
    if (to === PROCESS_PRODUCT) errors.push(`productMerges: \`${from}\` may never map to \`process\``)
  }

  const verdictFor = new Map<string, number>()
  for (const v of settlement.productVerdicts) {
    verdictFor.set(v.product, (verdictFor.get(v.product) ?? 0) + 1)
    if (!products.has(v.product)) {
      errors.push(`productVerdicts: \`${v.product}\` is not a non-core product of this corpus`)
    }
  }
  for (const [product, n] of verdictFor) if (n > 1) errors.push(`productVerdicts: \`${product}\` has ${n} verdicts`)
  const missing = [...products].filter((p) => !verdictFor.has(p)).sort()
  if (missing.length > 0) {
    errors.push(`productVerdicts: missing a verdict for ${missing.map((p) => `\`${p}\``).join(', ')} — every non-core product gets one`)
  }

  const seenLabels = new Set<string>()
  for (const sub of settlement.subdivisions) {
    if (seenLabels.has(sub.label)) {
      errors.push(`subdivisions: \`${sub.label}\` is subdivided twice`)
      continue
    }
    seenLabels.add(sub.label)
    const refs = vocab.concerns.get(sub.label)
    if (!refs) {
      errors.push(`subdivisions: \`${sub.label}\` is not a concern label of this corpus`)
      continue
    }
    const into = new Set(sub.into)
    for (const [ref, target] of Object.entries(sub.assignments)) {
      if (!into.has(target)) errors.push(`subdivisions \`${sub.label}\`: doc \`${ref}\` assigned to \`${target}\`, not one of \`into\``)
      if (!refs.includes(ref)) errors.push(`subdivisions \`${sub.label}\`: doc \`${ref}\` does not carry the label`)
    }
    const unassigned = refs.filter((ref) => !(ref in sub.assignments))
    if (unassigned.length > 0) {
      const shown = unassigned.slice(0, 5).map((r) => `\`${r}\``).join(', ')
      errors.push(
        `subdivisions \`${sub.label}\`: ${unassigned.length} doc(s) unassigned (${shown}${unassigned.length > 5 ? ', …' : ''}) — every doc of the label is assigned`,
      )
    }
  }
  return errors
}

/** What a valid settlement folds down to. */
export interface AppliedSettlement {
  /** The merge map the grouper applies (product collapse-to-core folded in). */
  vocab: VocabMap
  /** Per-doc concern rewrites: doc ref → (old concern → new concern). */
  reassignments: Map<string, Map<string, string>>
}

/**
 * Sanitize + apply a settlement — like the old vocab sanitize EXCEPT that
 * collapse-to-core is legal on this path. LENIENT where the validator is
 * strict, because a CACHED settlement (keyed on label sets alone) may meet a
 * slightly different doc set: unknown docs are skipped, an unassigned doc
 * keeps its label, an invalid mapping is dropped rather than refusing the
 * settlement whole.
 */
export function applySettlement(settlement: AreaSettlement, vocab: AreaVocabView): AppliedSettlement {
  const products = new Set(vocab.products.keys())
  const concerns = new Set(vocab.concerns.keys())
  const map: VocabMap = { products: {}, concerns: {} }

  for (const [from, to] of Object.entries(settlement.concernMerges)) {
    if (from === to || !concerns.has(from) || !concerns.has(to)) continue
    map.concerns[from] = to
  }
  for (const [from, to] of Object.entries(settlement.productMerges)) {
    if (from === to || !products.has(from)) continue
    if (to !== CORE_PRODUCT && !products.has(to)) continue
    if (to === PROCESS_PRODUCT) continue
    map.products[from] = to
  }
  // A collapse-to-core verdict IS a product merge onto core, however stated.
  for (const v of settlement.productVerdicts) {
    if (v.verdict === 'collapse-to-core' && products.has(v.product)) map.products[v.product] = CORE_PRODUCT
  }

  const reassignments = new Map<string, Map<string, string>>()
  for (const sub of settlement.subdivisions) {
    if (!concerns.has(sub.label)) continue
    const into = new Set(sub.into)
    for (const [ref, target] of Object.entries(sub.assignments)) {
      if (!into.has(target)) continue
      const perDoc = reassignments.get(ref) ?? new Map<string, string>()
      perDoc.set(sub.label, target)
      reassignments.set(ref, perDoc)
    }
  }
  return { vocab: map, reassignments }
}

function checkSettlementTool(vocab: AreaVocabView): SessionTool {
  return defineSessionTool({
    name: 'check_settlement',
    description:
      'Check a draft settlement against every rule the run enforces — product-verdict completeness, merge targets, subdivision assignment completeness. Call it on your complete draft before you produce the outcome.',
    kind: 'check-settlement',
    readOnly: true,
    destructive: false,
    inputSchema: AreaSettlementSchema,
    async execute(args) {
      const errors = validateSettlement(args, vocab)
      if (errors.length === 0) {
        return {
          content: `The settlement is valid: ${Object.keys(args.productMerges).length + Object.keys(args.concernMerges).length} merge(s), ${args.productVerdicts.length} verdict(s), ${args.subdivisions.length} subdivision(s). Produce it as the outcome.`,
        }
      }
      return { content: `${errors.length} problem(s):\n- ${errors.join('\n- ')}`, isError: true }
    },
  })
}

export interface SettleAreasSessionInput {
  vocab: AreaVocabView
  universe: ScanDocUniverse
}

export function settleAreasSessionDef(input: SettleAreasSessionInput): SessionDef<AreaSettlement> {
  return {
    kind: SETTLE_AREAS_SESSION_KIND,
    systemPrompt: SETTLE_AREAS_SYSTEM_PROMPT,
    tools: [
      docsWithLabelTool(input.universe, () => labelIndex(input.vocab)),
      readDocTool(input.universe),
      checkSettlementTool(input.vocab),
    ],
    outcomeSchema: AreaSettlementSchema,
    budget: SETTLE_AREAS_BUDGET,
    // The structural half of "run check_settlement": the shell refuses the
    // first outcome of a session that never validated its draft (one refusal
    // cycle, one turn), mirroring interface authoring's check_draft.
    outcomePrecondition: {
      tool: 'check_settlement',
      message:
        'Outcome refused: you never ran `check_settlement` in this session. Call `check_settlement` on your complete settlement now — it runs the exact validation the run applies, so a missing product verdict or an incomplete subdivision costs one turn here instead of the settlement at the outcome. Fix anything it reports, then produce the outcome again.',
    },
  }
}

/** Both axes' labels → doc refs, for `docs_with_label`. */
function labelIndex(vocab: AreaVocabView): Map<string, readonly string[]> {
  const out = new Map<string, readonly string[]>()
  for (const [label, refs] of vocab.concerns) out.set(label, refs)
  // A product sharing a concern's name is rare; the concern listing wins there
  // (union would blur which axis the session asked about).
  for (const [label, refs] of vocab.products) if (!out.has(label)) out.set(label, refs)
  return out
}

export const SETTLE_AREAS_WORK_ITEM = 'vocabulary'

export function settleAreasBriefing(vocab: AreaVocabView, instructions: readonly string[] = []): string {
  const line = (map: Map<string, string[]>): string[] =>
    [...map.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([label, refs]) => `  ${label}  (${refs.length} doc${refs.length === 1 ? '' : 's'})`)
  const lines = [
    ...instructionsBriefingBlock(instructions),
    `Settle the area vocabulary of this doc corpus.`,
    '',
    vocab.products.size > 0
      ? `Non-core products (${vocab.products.size}):`
      : `Non-core products: none — every doc tagged core (or process).`,
    ...line(vocab.products),
    '',
    `Concerns (${vocab.concerns.size}):`,
    ...line(vocab.concerns),
  ]
  if (vocab.overThreshold.length > 0) {
    lines.push(
      '',
      `Oversized concerns (over ${SUBDIVISION_DOC_THRESHOLD} docs) — subdivision candidates:`,
      ...vocab.overThreshold.map((label) => `  ${label}`),
    )
  }
  lines.push(
    '',
    'Merge what names the same thing, give every non-core product its verdict,',
    'subdivide an oversized concern only when it genuinely bundles distinct slices.',
    'Check the draft with `check_settlement`, then produce the outcome.',
  )
  return lines.join('\n')
}
