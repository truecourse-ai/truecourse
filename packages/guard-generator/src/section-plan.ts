/**
 * The deterministic, LLM-free front of the generator: derive the doc universe,
 * its sections, and which sections are WORK (need classifying / generating) vs
 * unchanged (skipped entirely). Reuses guard-runner's section index and recipe
 * fingerprint so the anchors/fingerprints it plans against are byte-identical to
 * what a `guard run` binds against.
 *
 * Doc universe = the corpus-kept docs (`.truecourse/specs/corpus.json`, read
 * tolerantly) — the corpus is the single authority on which docs are spec.
 * A repo without a corpus has nothing to generate against: run `spec scan`.
 * (The RUNNER additionally indexes scenario-bound docs, which it must for
 * stale/orphan detection; generation deliberately does not.)
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  indexRepoDocs,
  extractSectionTexts,
  nodeRefContext,
  computeRecipeFingerprint,
  recipePath,
  readManifest,
} from '@truecourse/guard-runner'
import {
  GUARD_FORMAT_VERSION,
  guardManifestSections,
  type GuardManifestFlow,
  type GuardManifestGapSection,
  type GuardManifestSectionView,
} from '@truecourse/shared'
import {
  parseOpenApiSpec,
  isOpenApiDoc,
  hasOpenApiExtension,
  openApiServerBasePath,
  type OpenApiDoc,
} from '@truecourse/shared/openapi'
import {
  EXTRACT_PROMPT_FINGERPRINT,
  FLOWS_PROMPT_FINGERPRINT,
  FLOWS_EPIC_PROMPT_FINGERPRINT,
  MATCH_PROMPT_FINGERPRINT,
  GENERATE_PROMPT_FINGERPRINT,
  GENERATE_API_PROMPT_FINGERPRINT,
  FIDELITY_PROMPT_FINGERPRINT,
} from './prompts.js'
import { readSuppressionIndex, suppressedQuotesIn, suppressionKey } from './suppression.js'
import { buildOperationIndex, matchedSchemaFingerprint } from './openapi-enrich.js'
import { securityFingerprintForSection } from './openapi-security.js'

/** One section fed to the LLM stages — its identity, its text, and area context. */
export interface SectionInput {
  /** Repo-relative doc path. */
  doc: string
  /** Slugified heading path (the binding anchor). */
  anchor: string
  /** `sha256:…` over the full (descendant-inclusive) section text. */
  fingerprint: string
  /** Raw heading text, for display. */
  headingText: string
  /** Heading level (0 for a whole-doc, non-markdown section). */
  level: number
  /** Heading + preamble before the first subsection — the binding-rule unit. */
  ownText: string
  /** Heading + everything up to the next same-or-higher heading. */
  fullText: string
  /** Canonical area ids the doc covers, from the corpus (empty when no corpus). */
  areaTags: string[]
  /**
   * Content key over this section's stale-suppressed quotes: the losing side of a
   * side-verdict resolution whose disputed sentence lives in this section. Folded
   * into {@link sectionInputsKey} so a newly-suppressed (or un-suppressed) section
   * re-detects as WORK and re-extracts freshly. Empty (`''`) when nothing is
   * suppressed here — the section's inputs hash is then the fingerprint alone, so
   * unaffected sections keep their manifest entry.
   */
  suppressionFingerprint: string
  /**
   * Content key over the OpenAPI write-op request schemas this (markdown) section's
   * prose references. Folded into {@link sectionInputsKey} and the authoring cache
   * key ONLY when non-empty, so a section that references no OpenAPI write op is
   * byte-identical to before enrichment; a section that references one re-plans and
   * re-authors when that operation's schema changes. Empty (`''`) for an OpenAPI
   * operation section itself and for any section with no write-op match.
   */
  endpointSchemaFingerprint: string
  /**
   * Content key over an OpenAPI operation section's security inputs that live OUTSIDE
   * its `canonicalText`: the effective OR-of-AND scheme groups (folding the doc-level
   * `security` fallback) and the resolved `components.securitySchemes` definitions
   * they reference. Folded into {@link sectionInputsKey} and the authoring cache key
   * ONLY when non-empty, so a PUBLIC / markdown / cli section keys off its text alone;
   * a SECURED section re-plans once on rollout and again whenever a referenced scheme
   * definition changes (a change the section fingerprint cannot see). Empty (`''`) for
   * a public or non-operation section.
   */
  securityFingerprint: string
}

export interface GuardWorkPlan {
  /** False when no corpus has been scanned yet. */
  hasUniverse: boolean
  /** Every section across the doc universe, in doc + document order. */
  sections: SectionInput[]
  /** Sections whose text moved since the last generate, plus sections no flow binds. */
  work: SectionInput[]
  /** Manifest entries whose section no longer exists — reported, never deleted. */
  orphaned: GuardManifestSectionView[]
  /** `sha256:…` over the recipe's discovery-input files. */
  recipeFingerprint: string
  /** True when `recipe.json` is absent (discovery will run). */
  recipeMissing: boolean
  /** Losing doc → its stale-suppressed quotes; the extraction stage injects these
   *  so a resolved dispute's loser yields no claims. Empty when no side verdict
   *  currently suppresses anything. */
  suppressionIndex: Map<string, string[]>
  /** OpenAPI doc → its `servers` base path (`/api/v1`), for base-path-aware prose→op
   *  matching. Absent/`''` for base-path-less specs. The generator reuses this map
   *  so its own operation index matches identically to the plan's. */
  basePaths: Map<string, string>
}

// A tolerant local view of the corpus — just the kept docs' refs + area tags. We
// never import the consolidator; a shape we don't understand degrades to no tags.
const CorpusShape = z
  .object({
    docs: z
      .array(z.object({ ref: z.string(), areaTags: z.array(z.string()).optional() }).passthrough())
      .optional(),
  })
  .passthrough()

/** Doc ref → its canonical area ids, read tolerantly from the corpus (or empty). */
export function readCorpusAreaTags(repoRoot: string): Map<string, string[]> {
  const file = path.join(repoRoot, '.truecourse', 'specs', 'corpus.json')
  const map = new Map<string, string[]>()
  if (!fs.existsSync(file)) return map
  try {
    const parsed = CorpusShape.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')))
    if (!parsed.success) return map
    for (const d of parsed.data.docs ?? []) map.set(d.ref, d.areaTags ?? [])
  } catch {
    /* unreadable corpus → no area context, not a failure */
  }
  return map
}

/**
 * The corpus's OpenAPI documents (path + raw text), read directly — no section
 * planning, no manifest, no LLM. The extension gate means a markdown-only corpus
 * reads NOTHING off disk, which is what makes this cheap enough for a read path
 * (`guard recipe`) as well as generate's own credential validation. A doc listed
 * in the corpus but missing from the tree is skipped, never a throw.
 */
export function corpusOpenApiDocs(repoRoot: string): { doc: string; content: string }[] {
  const out: { doc: string; content: string }[] = []
  for (const ref of readCorpusAreaTags(repoRoot).keys()) {
    if (!hasOpenApiExtension(ref)) continue
    let content: string
    try {
      content = fs.readFileSync(path.resolve(repoRoot, ref), 'utf-8')
    } catch {
      continue
    }
    if (isOpenApiDoc(ref, content)) out.push({ doc: ref, content })
  }
  return out
}

/**
 * ONE section's content key, as the flow hash folds it: the section-text
 * fingerprint plus the three inputs a scenario depends on that the text itself
 * cannot see — the stale quotes a conflict verdict suppresses, the OpenAPI write-op
 * request schema its prose references, and a secured operation's resolved security
 * context. Each is appended ONLY when non-empty, so an unaffected section's key is
 * exactly its fingerprint.
 */
export function sectionInputsKey(section: {
  fingerprint: string
  suppressionFingerprint?: string
  endpointSchemaFingerprint?: string
  securityFingerprint?: string
}): string {
  const parts = [section.fingerprint]
  if (section.suppressionFingerprint) parts.push(section.suppressionFingerprint)
  if (section.endpointSchemaFingerprint) parts.push(section.endpointSchemaFingerprint)
  if (section.securityFingerprint) parts.push(section.securityFingerprint)
  return parts.join('|')
}

/**
 * The generation-inputs hash stamped per FLOW — the incremental gate. It moves
 * when the flow's milestone composition changes, when any BOUND SECTION's content
 * key moves (its text, a suppressed quote, a referenced OpenAPI schema, its
 * security context), when a JOURNEY the flow's plans ground on moves (the code
 * surface changed under it — and only those journeys, never the whole catalog, so
 * unrelated route churn re-authors nothing), when the recipe inputs change, when
 * the scenario format version bumps, or when ANY LLM stage's prompt in the flow
 * pipeline changes (extraction, synthesis, matching, authoring, fidelity review).
 * A flow is WORK exactly when this differs from (or is absent in) the committed
 * manifest — so an unchanged flow is a deterministic no-op, and a prompt edit
 * re-runs the flows it affects.
 */
export function flowGenerationInputsHash(input: {
  flowFingerprint: string
  /** Every bound section's {@link sectionInputsKey}, in any order (sorted here). */
  sectionKeys: readonly string[]
  /** The fingerprints of exactly the journeys the flow's plans ground on. */
  journeyFingerprints: readonly string[]
  recipeFingerprint: string
}): string {
  const parts = [
    input.flowFingerprint,
    [...input.sectionKeys].sort().join(''),
    [...input.journeyFingerprints].sort().join(''),
    input.recipeFingerprint,
    String(GUARD_FORMAT_VERSION),
    EXTRACT_PROMPT_FINGERPRINT,
    FLOWS_PROMPT_FINGERPRINT,
    FLOWS_EPIC_PROMPT_FINGERPRINT,
    MATCH_PROMPT_FINGERPRINT,
    GENERATE_PROMPT_FINGERPRINT,
    GENERATE_API_PROMPT_FINGERPRINT,
    FIDELITY_PROMPT_FINGERPRINT,
  ]
  return 'sha256:' + createHash('sha256').update(parts.join('\0')).digest('hex')
}

/**
 * The manifest's GAP-SECTION records for a set of manifest entries: every live
 * section those entries leave unaccounted for. Extraction and synthesis both run
 * over the WHOLE universe on every completed run, so a section no flow binds is one
 * whose claims all settled as coverage gaps (untestable, dismissed, awaiting a
 * driver, blocked on a missing preparation) — accounted for, but with nothing to
 * bind it.
 *
 * Recording it is what makes an unchanged corpus a no-op for a CLONE: without it the
 * section's settledness lives only in the gitignored caches, so a fresh checkout
 * re-plans it as work (and the estimate re-prices synthesis) forever. It is derived
 * from the LIVE sections, so a deleted or renamed section's record disappears with
 * it and an edited one re-opens as work.
 *
 * A section counts as bound only by a LIVE entry holding a binding at the section's
 * CURRENT fingerprint. An orphaned entry is frozen history — synthesis stopped
 * producing its flow, and its bindings still name the text it was authored against
 * — so a rewritten section whose flow orphaned out is flowless as of this run, and
 * its gaps are what accounts for it now.
 *
 * ONE derivation, shared by the full run and the no-op short-circuit: the no-op's
 * promise is a byte-identical manifest, which a second implementation could not keep.
 */
export function gapSectionRecords(
  sections: readonly SectionInput[],
  flows: readonly GuardManifestFlow[],
): GuardManifestGapSection[] {
  const bound = new Set<string>()
  for (const flow of flows) {
    if (flow.orphaned) continue
    for (const b of flow.bindings) bound.add(`${b.doc}\0${b.anchor}\0${b.fingerprint}`)
  }
  return sections
    .filter((s) => !bound.has(`${s.doc}\0${s.anchor}\0${s.fingerprint}`))
    .map((s) => ({ doc: s.doc, anchor: s.anchor, fingerprint: s.fingerprint }))
}

/** Whether a corpus exists — the corpus is generation's only doc authority. */
export function hasGuardUniverse(repoRoot: string): boolean {
  return fs.existsSync(path.join(repoRoot, '.truecourse', 'specs', 'corpus.json'))
}

/**
 * Plan the deterministic work for a generate run. `recipeFingerprint` defaults to
 * the current recipe-input fingerprint; the driver passes the fingerprint of a
 * just-discovered recipe when it differs.
 */
export function planGuardWork(repoRoot: string, recipeFingerprint?: string): GuardWorkPlan {
  const recipeFp = recipeFingerprint ?? computeRecipeFingerprint(repoRoot)
  const recipeMissing = !fs.existsSync(recipePath(repoRoot))

  const hasUniverse = hasGuardUniverse(repoRoot)
  const { indexes } = indexRepoDocs(repoRoot, [])
  const areaTags = readCorpusAreaTags(repoRoot)
  // Section-scoped conflict verdicts: losing doc → stale quotes. A section carrying a
  // suppressed quote gets a non-empty suppressionFingerprint, which re-keys ONLY that
  // section (unaffected sections stay byte-identical).
  const suppressionIndex = readSuppressionIndex(repoRoot)

  const sections: SectionInput[] = []
  // The parsed OpenAPI doc per doc (null for markdown), reused to stamp each operation
  // section's securityFingerprint below. `basePaths` carries each OpenAPI doc's
  // `servers` base path for base-path-aware prose→op matching.
  const parsedDocs = new Map<string, OpenApiDoc | null>()
  const basePaths = new Map<string, string>()
  for (const [doc, index] of indexes) {
    const content = fs.readFileSync(path.resolve(repoRoot, doc), 'utf-8')
    const isOpenApi = isOpenApiDoc(doc, content)
    parsedDocs.set(doc, isOpenApi ? parseOpenApiSpec(content) : null)
    if (isOpenApi) {
      const base = openApiServerBasePath(content)
      if (base) basePaths.set(doc, base)
    }
    const texts = extractSectionTexts(doc, content, nodeRefContext(repoRoot, doc))
    const docQuotes = suppressionIndex.get(doc) ?? []
    for (const s of index.sections) {
      const t = texts.get(s.anchor)
      const fullText = t?.fullText ?? ''
      sections.push({
        doc,
        anchor: s.anchor,
        fingerprint: s.fingerprint,
        headingText: s.headingText,
        level: s.level,
        ownText: t?.ownText ?? '',
        fullText,
        areaTags: areaTags.get(doc) ?? [],
        suppressionFingerprint: suppressionKey(suppressedQuotesIn(fullText, docQuotes)),
        // Both fingerprints are stamped below (endpoint one needs the cross-doc index).
        endpointSchemaFingerprint: '',
        securityFingerprint: '',
      })
    }
  }
  // Index every OpenAPI operation across the universe, then stamp each section with a
  // content key over the write-op schemas its prose references. Empty for any section
  // that references none (byte-identical to before enrichment).
  const opIndex = buildOperationIndex(sections, basePaths)
  for (const s of sections) {
    s.endpointSchemaFingerprint = matchedSchemaFingerprint(s, opIndex)
    // A secured OpenAPI operation section keys on its security groups + referenced
    // scheme defs (empty for public/markdown — their key stays the text fingerprint).
    s.securityFingerprint = securityFingerprintForSection(s, parsedDocs.get(s.doc) ?? null)
  }
  sections.sort((a, b) => a.doc.localeCompare(b.doc) || a.anchor.localeCompare(b.anchor))

  // Section CHANGE detection, off the manifest's TWO accounting records: the
  // flows' bindings, and the gap sections — the ones that settled with every claim
  // gapped, so no flow could ever bind them. A section is WORK exactly when NO
  // record was taken against its current text.
  //
  // "No record" is a question about the SET, never about one record: a section is
  // legitimately bound by several flows at several fingerprints, because an
  // ORPHANED entry is carried forward untouched with its bindings frozen at the
  // text it was authored against. Comparing against a single (arbitrarily chosen)
  // record made a section that a live flow guards today read as changed on every
  // run and in every estimate, for good — its text never moves again, so nothing
  // could ever clear it. Both records are committed, so a clone with no caches at
  // all plans the same (empty) work as the machine that generated.
  //
  // The incremental GATE is per flow — everything global (recipe, prompts, format,
  // the journeys a flow grounds on) rides `flowGenerationInputsHash`, so this
  // stays a pure spec-side question, and a flow whose own binding went stale
  // re-authors on its hash whatever this says.
  const manifest = readManifest(repoRoot)
  const manifestSections = guardManifestSections(manifest)
  const accounted = new Map<string, Set<string>>()
  const account = (doc: string, anchor: string, fingerprint: string): void => {
    const key = `${doc}\0${anchor}`
    const fingerprints = accounted.get(key)
    if (fingerprints) fingerprints.add(fingerprint)
    else accounted.set(key, new Set([fingerprint]))
  }
  for (const flow of manifest?.flows ?? []) for (const b of flow.bindings) account(b.doc, b.anchor, b.fingerprint)
  for (const g of manifest?.gapSections ?? []) account(g.doc, g.anchor, g.fingerprint)
  const seen = new Set<string>()

  const work: SectionInput[] = []
  for (const s of sections) {
    const key = `${s.doc}\0${s.anchor}`
    seen.add(key)
    if (!accounted.get(key)?.has(s.fingerprint)) work.push(s)
  }

  // Orphans are BOUND sections that vanished — their scenarios are kept and
  // reported as stale drift. A vanished GAP section has no scenario and no flow
  // behind it, so it is nothing to report: the next generate derives its records
  // from the live sections again and it simply stops being written.
  const orphaned = manifestSections.filter((e) => !seen.has(`${e.doc}\0${e.anchor}`))

  return { hasUniverse, sections, work, orphaned, recipeFingerprint: recipeFp, recipeMissing, suppressionIndex, basePaths }
}

/** One work document fed to extraction: its full text plus ALL its sections. */
export interface GuardDoc {
  /** Repo-relative doc path. */
  doc: string
  /** The document's full text — the extraction input (chunked when over budget). */
  content: string
  /** Every section of the doc, in document order — the outline + snapping set. */
  sections: SectionInput[]
  /**
   * This doc's stale-suppressed quotes, when it is the losing side of a side
   * verdict. Extraction injects a "resolved stale — extract no claim asserting
   * this" block for the quotes present in each view, so the loser's disputed claim
   * is never authored. Empty ⇒ extraction is byte-identical to an unsuppressed doc.
   */
  suppressedQuotes: string[]
}

/**
 * The documents that contain at least one WORK (changed/new) section — the unit
 * extraction reads. Each carries its full text and ALL its sections (the outline
 * the model picks anchors from), even the unchanged ones; the caller filters
 * extracted claims down to the work sections. Sections come straight from the
 * plan, so their anchors/fingerprints match what a run binds against.
 */
export function collectWorkDocs(repoRoot: string, plan: GuardWorkPlan): GuardDoc[] {
  const workDocs = new Set(plan.work.map((s) => s.doc))
  const byDoc = new Map<string, SectionInput[]>()
  for (const s of plan.sections) {
    if (!workDocs.has(s.doc)) continue
    const list = byDoc.get(s.doc)
    if (list) list.push(s)
    else byDoc.set(s.doc, [s])
  }
  return [...byDoc].map(([doc, sections]) => ({
    doc,
    content: fs.readFileSync(path.resolve(repoRoot, doc), 'utf-8'),
    sections,
    suppressedQuotes: plan.suppressionIndex.get(doc) ?? [],
  }))
}
