/**
 * The deterministic, LLM-free front of the generator: derive the doc universe
 * and, for the LLM stages that read documents, each document's sections — the
 * outline a session orients by and the text under one heading it reads. The
 * sections are a reading aid derived from the shared document tree, never
 * something a flow or a scenario binds to: bindings go by sentence.
 *
 * Doc universe = the corpus-kept docs (`.truecourse/specs/corpus.json`, read
 * tolerantly) — the corpus is the single authority on which docs are spec.
 * A repo without a corpus has nothing to generate against: the Document scan
 * curates one first.
 * (The RUNNER additionally reads scenario-bound docs, which it must for
 * stale/orphan detection; generation deliberately does not.)
 */

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { computeRecipeFingerprint, recipePath, readManifest } from '@truecourse/guard-runner'
import {
  movedSchemeInputs,
  parseDocTree,
  sectionOwnText,
  sectionText,
  slugifyHeading,
  type DocTree,
} from '@truecourse/shared'
import {
  deriveOpenApiSections,
  parseOpenApiSpec,
  isOpenApiDoc,
  hasOpenApiExtension,
  openApiServerBasePath,
  type OpenApiDoc,
  type RefResolutionContext,
} from '@truecourse/shared/openapi'
import { nodeRefContext } from '@truecourse/shared/openapi-node'
import { securityFingerprintForSection } from './openapi-security.js'
import { corpusFilePath } from '@truecourse/shared/work-tree'

/**
 * One section of a document as the LLM stages read it: the text under one
 * heading, with the heading chain slugified as the handle a session's read
 * tool addresses it by. For an OpenAPI document the sections are its OPERATIONS,
 * each a canonical serialization of the resolved operation.
 */
export interface SectionInput {
  /** Repo-relative doc path. */
  doc: string
  /** Slugified heading path — the handle a read tool addresses the section by. */
  anchor: string
  /** Raw heading text, for display. */
  headingText: string
  /** Heading level (0 for the lead and a whole-doc, non-markdown section). */
  level: number
  /** 1-based first line of the section. */
  startLine: number
  /** 1-based last line of the section's own text, before its first subsection. */
  ownEndLine: number
  /** Heading + preamble before the first subsection. */
  ownText: string
  /** Heading + everything up to the next same-or-higher heading. */
  fullText: string
  /** Canonical area ids the doc covers, from the corpus (empty when no corpus). */
  areaTags: string[]
}

export interface GuardWorkPlan {
  /** False when no corpus has been scanned yet. */
  hasUniverse: boolean
  /** Every document of the universe, with its text and its sections, in doc order. */
  docs: GuardDoc[]
  /** The documents whose text changed since the last generate recorded them, or that it never recorded. */
  changedDocs: Set<string>
  /** `sha256:…` over the recipe's discovery-input files. */
  recipeFingerprint: string
  /** True when `recipe.json` is absent (discovery will run). */
  recipeMissing: boolean
  /** OpenAPI doc → its `servers` base path (`/api/v1`), for base-path-aware prose→op
   *  matching. Absent/`''` for base-path-less specs. The generator reuses this map
   *  so its own operation index matches identically to the plan's. */
  basePaths: Map<string, string>
}

/** One document of the universe: its full text plus ALL its sections. */
export interface GuardDoc {
  /** Repo-relative doc path. */
  doc: string
  /** The document's full text. */
  content: string
  /** The document's tree, whose sentences claims and bindings resolve through. */
  tree: DocTree
  /** Canonical area ids the doc covers, from the corpus (empty when no corpus). */
  areaTags: string[]
  /** Every section of the doc, in document order — the outline + the read tool's handles. */
  sections: SectionInput[]
}

/**
 * Derive the sections of a document for the LLM stages. An OpenAPI document is
 * the one doc the tree does not cut: its sections are its operations, one per
 * (method, path), under a synthetic `paths/<method>-<slug>` handle. A doc
 * detected as OpenAPI but declaring no operations falls through to the tree's
 * whole-doc section.
 */
export function deriveDocSections(doc: string, content: string, tree: DocTree, areaTags: string[], ctx?: RefResolutionContext): SectionInput[] {
  const openApiSections = isOpenApiDoc(doc, content) ? deriveOpenApiSections(content, ctx) : []
  if (openApiSections.length > 0) {
    const total = tree.sections[0]!.endLine
    const used = new Set<string>()
    return openApiSections.map((op) => {
      const slug = slugifyHeading(`${op.method}-${op.slugSource}`) || 'operation'
      const base = `paths/${slug}`
      let anchor = base
      for (let n = 2; used.has(anchor); n++) anchor = `${base}-${n}`
      used.add(anchor)
      return { doc, anchor, headingText: op.headingText, level: 1, startLine: 1, ownEndLine: total, ownText: op.canonicalText, fullText: op.canonicalText, areaTags }
    })
  }
  return tree.sections.map((s) => ({
    doc,
    anchor: s.anchor,
    headingText: s.headingText,
    level: s.level,
    startLine: s.startLine,
    ownEndLine: s.ownEndLine,
    ownText: sectionOwnText(tree, s),
    fullText: sectionText(tree, s),
    areaTags,
  }))
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
  const file = corpusFilePath(repoRoot)
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

/** A flow's settle inputs, before {@link flowGenerationInputComponents} names them. */
export interface FlowGenerationInputParts {
  flowFingerprint: string
  /** Each plan's realization-assignment fingerprint. */
  assignmentFingerprints: readonly string[]
  /** The planned interfaces' fingerprints. */
  interfaceFingerprints: readonly string[]
  /** Each catalog entry the flow's web session was served, with its CURRENT
   *  fingerprint. Present (possibly empty) for a flow with a web plan. */
  webCatalogReads?: readonly string[]
  /** The recipe slice of the surface this flow is realized on. */
  recipeSlice: string
  /**
   * Whether the flow holds a committed scenario. The interface catalog is a
   * settle input only of a flow that does not: a task change never re-writes a
   * scenario that exists.
   */
  hasScenario: boolean
  /** The seed roster entries the flow's committed scenarios name. */
  roster: string
  /** The preparation profiles those scenarios name, with their script bytes. */
  preparation: string
}

/**
 * A flow's settle inputs BY NAME — the record the compare reads and the flow
 * carries in the manifest. Every value is a short digest: the record compares a
 * name against itself across two runs, never recomputes a hash, and a name that
 * is not on both sides is not a comparison at all (see `movedSchemeInputs`).
 *
 * Prompt fingerprints are deliberately absent. A committed flow has been run
 * and proven, and rewording the prompt that wrote it does not make it wrong.
 *
 * The INTERFACE CATALOG (`assignment`, `interfaces`, `webCatalog.reads`) is a
 * settle input only of a flow that holds no committed scenario: a task that
 * is new, amended or retired may still give such a flow the scenario it lacks
 * (a blocked flow re-briefed, a gapped one matched), but it never re-writes a
 * scenario that exists. Its steps were frozen when it was written, and a moved
 * task is the drift dot a run draws beside it (`isInterfaceDrifted`), never a
 * reason to author it again. A stored row that still carries those names is
 * compared without them (a name on one side only is no comparison), so
 * narrowing the rule re-opens nothing.
 */
export function flowGenerationInputComponents(parts: FlowGenerationInputParts): Record<string, string> {
  const digest = (values: readonly string[]): string =>
    createHash('sha256').update([...values].sort().join('\0')).digest('hex').slice(0, 16)
  const components: Record<string, string> = {
    // The flow fingerprint folds each milestone's claim id, and a claim's id is
    // the hash of its sentences: a reworded sentence is a new claim, a new
    // fingerprint and a re-opened flow, with no text key of its own.
    flow: digest([parts.flowFingerprint]),
    'recipe.slice': digest([parts.recipeSlice]),
    roster: digest([parts.roster]),
    // Its own name, not the retired `preparation`: that one folded each
    // profile's qualification evidence too, which the session rewrites whenever
    // a cited file moves, and a stored value under it would re-open every flow.
    'preparation.run': digest([parts.preparation]),
  }
  if (parts.hasScenario) return components
  components.assignment = digest(parts.assignmentFingerprints)
  components.interfaces = digest(parts.interfaceFingerprints)
  // The web catalog enters by what the flow's session READ, never whole: an
  // unrelated screen's re-authored readables used to re-open every web flow.
  // A row that carries no read-set (it predates the record, or its session
  // never ran) has this name filled in with no session, which is also why such
  // a row cannot be re-opened through this path until it next authors.
  if (parts.webCatalogReads) components['webCatalog.reads'] = digest(parts.webCatalogReads)
  return components
}

/**
 * The SETTLED marker a flow leaves behind: one digest over its whole component
 * record. Many readers treat a non-null `generationInputsHash` as "this flow is
 * settled", so the marker stays a `sha256:` string — but nothing recomputes it
 * to decide whether the flow holds any more. That is the components' job.
 */
export function flowSettleDigest(components: Readonly<Record<string, string>>): string {
  const canonical = Object.keys(components)
    .sort()
    .map((name) => `${name}=${components[name]}`)
    .join('|')
  return 'sha256:' + createHash('sha256').update(canonical).digest('hex')
}

/** What a stored flow entry has to say about whether it still holds. */
export interface FlowSettleCheck {
  /** The manifest row, or `undefined` for a flow nothing has authored. */
  prior:
    | { generationInputsHash: string | null; generationInputs?: Readonly<Record<string, string>> }
    | undefined
  /** The components the CURRENT scheme computes for this flow. */
  components: Readonly<Record<string, string>>
}

/**
 * Does this flow still hold? A row WITH components is compared name by name:
 * `moved` names the ones that differ, and an empty list settles the flow. A row
 * without a hash, or with a hash and no components, is not settled: it names no
 * input, so `moved` is `null` and the report counts it unrecorded.
 */
export function flowSettleVerdict(check: FlowSettleCheck): { settled: boolean; moved: string[] | null } {
  const prior = check.prior
  if (!prior || prior.generationInputsHash === null || !prior.generationInputs) {
    return { settled: false, moved: null }
  }
  const moved = movedSchemeInputs(prior.generationInputs, check.components)
  return { settled: moved.length === 0, moved }
}

/** Whether a corpus exists — the corpus is generation's only doc authority. */
export function hasGuardUniverse(repoRoot: string): boolean {
  return fs.existsSync(corpusFilePath(repoRoot))
}

/**
 * Plan the deterministic work for a generate run: the doc universe with each
 * document's tree and sections, and which documents changed since the last
 * generate recorded them. `recipeFingerprint` defaults to the current
 * recipe-input fingerprint; the driver passes the fingerprint of a
 * just-discovered recipe when it differs.
 */
export function planGuardWork(repoRoot: string, recipeFingerprint?: string): GuardWorkPlan {
  const recipeFp = recipeFingerprint ?? computeRecipeFingerprint(repoRoot)
  const recipeMissing = !fs.existsSync(recipePath(repoRoot))

  const hasUniverse = hasGuardUniverse(repoRoot)
  const areaTags = readCorpusAreaTags(repoRoot)

  const docs: GuardDoc[] = []
  // Each OpenAPI doc's `servers` base path, for base-path-aware prose→op matching.
  const basePaths = new Map<string, string>()
  for (const doc of [...areaTags.keys()].sort()) {
    const abs = path.resolve(repoRoot, doc)
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue
    const content = fs.readFileSync(abs, 'utf-8')
    if (isOpenApiDoc(doc, content)) {
      const base = openApiServerBasePath(content)
      if (base) basePaths.set(doc, base)
    }
    const tree = parseDocTree(doc, content)
    const tags = areaTags.get(doc) ?? []
    docs.push({ doc, content, tree, areaTags: tags, sections: deriveDocSections(doc, content, tree, tags, nodeRefContext(repoRoot, abs)) })
  }

  // A document is changed when its text differs from what the last generate
  // recorded, or when no generate recorded it. The incremental GATE is per flow —
  // everything global rides each flow's settle inputs — so this is reporting.
  const recorded = new Map((readManifest(repoRoot)?.docs ?? []).map((d) => [d.doc, d.contentHash]))
  const changedDocs = new Set(docs.filter((d) => recorded.get(d.doc) !== docContentHash(d.content)).map((d) => d.doc))

  return { hasUniverse, docs, changedDocs, recipeFingerprint: recipeFp, recipeMissing, basePaths }
}

/** `sha256` hex over a document's text, the key the manifest remembers a document by. */
export function docContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}
