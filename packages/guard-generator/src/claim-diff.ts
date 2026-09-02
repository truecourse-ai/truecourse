/**
 * The claim-diff gate: before extraction, decide per EDITED document whether
 * its edits changed any obligation. When every edited section of a document is
 * judged cosmetic, the document's prior extraction outcome is reused verbatim
 * (no session, no reworded claims) and the flows bound to those sections are
 * spared a re-author — the per-flow gate in `generateGuards` substitutes the
 * sections' prior fingerprints and finds the committed inputs hash unchanged.
 *
 * The gate compares each section's OWN text before and after the edit (the
 * prior text comes from a content-keyed cache every generate fills), so an
 * ancestor heading whose own prose did not move is never judged by itself: it
 * is cosmetic exactly when every edited subsection under it is.
 *
 * Fail closed everywhere: an unknown prior (hash, text, or extraction), a
 * vanished or new section, a gate error, or a single `changed` verdict leaves
 * the document to extraction exactly as before the gate existed.
 */
import { createHash } from 'node:crypto'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import { guardManifestSections, type GuardManifest } from '@truecourse/shared'
import { extractSectionTexts, nodeRefContext, normalizeSectionText } from '@truecourse/guard-runner'
import { snapExtraction, type ReuseExtractionSeam } from './extract.js'
import { flowSectionKey } from './flows.js'
import { CLAIM_DIFF_PROMPT_FINGERPRINT, type ClaimDiffSectionInput } from './prompts.js'
import { ClaimDiffSchema, type ClaimDiff } from './schemas.js'
import type { ClaimDiffRunner } from './runners.js'
import type { GuardDoc, SectionInput } from './section-plan.js'

export const CLAIM_DIFF_CACHE_NAME = 'guard/claim-diff'
/** Document text by content hash — what lets the next generate see the OLD
 *  text of an edited document. Filled for every doc extraction reads. */
export const DOC_TEXT_CACHE_NAME = 'guard/doc-text'

export interface ClaimDiffGateResult {
  /** `flowSectionKey(doc, anchor)` → the section's PRIOR text fingerprint, for
   *  every changed section judged cosmetic in a document whose extraction was
   *  reused. The per-flow gate keys off this. */
  cosmetic: Map<string, string>
  /** Documents whose prior extraction was reused this run. */
  reusedDocs: string[]
  /** Live gate calls made (cache hits excluded). */
  calls: number
  /** One message per document the gate could not judge (runner failure) and
   *  therefore left to extraction. */
  errors: string[]
}

export const EMPTY_CLAIM_DIFF_GATE: ClaimDiffGateResult = { cosmetic: new Map(), reusedDocs: [], calls: 0, errors: [] }

export interface ReuseCosmeticExtractionsInput {
  repoRoot: string
  /** Every document extraction is about to read (the whole universe). */
  docs: readonly GuardDoc[]
  priorManifest: GuardManifest | null
  seam: ReuseExtractionSeam
  runner: ClaimDiffRunner
}

/** Hex sha256 over a document's bytes — the manifest's `docs[].contentHash`. */
export function docContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

/** Remember every document's text under its content hash, so a later generate
 *  can show the gate what an edited document said before. Idempotent. */
export async function rememberDocTexts(repoRoot: string, docs: readonly GuardDoc[]): Promise<void> {
  for (const doc of docs) {
    await setCacheEntry(repoRoot, DOC_TEXT_CACHE_NAME, docContentHash(doc.content), { content: doc.content }).catch(
      () => undefined,
    )
  }
}

/** The gate's cache key: doctrine :: section :: old text :: new text :: prior
 *  claims. The same edit judged against the same prior is judged once. */
export function claimDiffCacheKey(section: ClaimDiffSectionInput): string {
  const prior = JSON.stringify({
    claims: [...section.priorClaims].map((c) => [c.claim, c.reason]).sort(),
    untestable: section.priorUntestable ?? null,
  })
  return createHash('sha256')
    .update(
      [CLAIM_DIFF_PROMPT_FINGERPRINT, section.doc, section.anchor, normalizeSectionText(section.oldText), normalizeSectionText(section.newText), prior].join('\0'),
    )
    .digest('hex')
}

export async function reuseCosmeticExtractions(input: ReuseCosmeticExtractionsInput): Promise<ClaimDiffGateResult> {
  const result: ClaimDiffGateResult = { cosmetic: new Map(), reusedDocs: [], calls: 0, errors: [] }
  const priorDocs = new Map((input.priorManifest?.docs ?? []).map((d) => [d.doc, d.contentHash]))
  if (priorDocs.size === 0) return result

  // The prior fingerprint of every section the last generate saw: bound ones
  // off the flows, uncovered ones off the persisted gap record.
  const priorFingerprints = new Map<string, string>()
  for (const view of guardManifestSections(input.priorManifest)) {
    priorFingerprints.set(flowSectionKey(view.doc, view.anchor), view.fingerprint)
  }
  for (const gap of input.priorManifest?.gapSections ?? []) {
    priorFingerprints.set(flowSectionKey(gap.doc, gap.anchor), gap.fingerprint)
  }

  for (const doc of input.docs) {
    const priorHash = priorDocs.get(doc.doc)
    if (!priorHash || priorHash === docContentHash(doc.content)) continue

    const priorText = await getCacheEntry(input.repoRoot, DOC_TEXT_CACHE_NAME, priorHash).catch(() => null)
    if (!isDocText(priorText)) continue
    const oldSections = extractSectionTexts(doc.doc, priorText.content, nodeRefContext(input.repoRoot, doc.doc))

    // Structure must be identical: a new or vanished section is a claim-set
    // change no per-section verdict can vouch for.
    const liveAnchors = new Set(doc.sections.map((s) => s.anchor))
    if (oldSections.size !== liveAnchors.size || [...liveAnchors].some((a) => !oldSections.has(a))) continue
    if (doc.sections.some((s) => priorFingerprints.get(flowSectionKey(s.doc, s.anchor)) === undefined)) continue

    const changed = doc.sections.filter((s) => priorFingerprints.get(flowSectionKey(s.doc, s.anchor)) !== s.fingerprint)
    const prior = await input.seam.lookup(doc, priorHash)
    if (!prior) continue
    const snapped = snapExtraction(prior, doc.sections)

    // Deepest first, so an ancestor whose own text did not move inherits its
    // edited subsections' verdicts instead of being judged as a whole.
    const byDepth = [...changed].sort((a, b) => depth(b.anchor) - depth(a.anchor))
    const changedAnchors = new Set<string>()
    let allCosmetic = true
    for (const section of byDepth) {
      const old = oldSections.get(section.anchor)!
      if (normalizeSectionText(old.ownText) === normalizeSectionText(section.ownText)) {
        // Own prose unchanged: cosmetic iff nothing under it was judged changed.
        if ([...changedAnchors].some((a) => a.startsWith(`${section.anchor}/`))) allCosmetic = false
        if (!allCosmetic) break
        continue
      }
      const gateInput: ClaimDiffSectionInput = {
        doc: section.doc,
        anchor: section.anchor,
        headingText: section.headingText,
        oldText: old.ownText,
        newText: section.ownText,
        priorClaims: snapped.claims
          .filter((c) => c.sectionAnchor === section.anchor)
          .map((c) => ({ claim: c.claim, reason: c.reason })),
      }
      const note = snapped.untestable.find((u) => u.sectionAnchor === section.anchor)
      if (note) gateInput.priorUntestable = note.reason
      const verdict = await judge(input, gateInput, result)
      if (verdict?.verdict !== 'cosmetic') {
        changedAnchors.add(section.anchor)
        allCosmetic = false
        break
      }
    }
    if (!allCosmetic) continue

    await input.seam.reuse(doc, priorHash)
    result.reusedDocs.push(doc.doc)
    for (const section of changed) {
      result.cosmetic.set(flowSectionKey(section.doc, section.anchor), priorFingerprints.get(flowSectionKey(section.doc, section.anchor))!)
    }
  }
  return result
}

const depth = (anchor: string): number => anchor.split('/').length

function isDocText(value: unknown): value is { content: string } {
  return typeof value === 'object' && value !== null && typeof (value as { content?: unknown }).content === 'string'
}

/** One cached verdict; a runner that fails twice yields null (⇒ changed). */
async function judge(
  input: ReuseCosmeticExtractionsInput,
  section: ClaimDiffSectionInput,
  result: ClaimDiffGateResult,
): Promise<ClaimDiff | null> {
  const key = claimDiffCacheKey(section)
  const cached = ClaimDiffSchema.safeParse(await getCacheEntry(input.repoRoot, CLAIM_DIFF_CACHE_NAME, key).catch(() => null))
  if (cached.success) return cached.data
  let lastError = 'invalid reply'
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      result.calls++
      const parsed = ClaimDiffSchema.safeParse(await input.runner(section))
      if (parsed.success) {
        await setCacheEntry(input.repoRoot, CLAIM_DIFF_CACHE_NAME, key, parsed.data).catch(() => undefined)
        return parsed.data
      }
    } catch (e) {
      lastError = (e as Error).message
    }
  }
  result.errors.push(
    `claim-diff gate could not judge ${section.doc} #${section.anchor} (${lastError}) — the document re-extracts and its flows re-author`,
  )
  return null
}
