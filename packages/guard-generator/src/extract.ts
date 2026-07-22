/**
 * Claim extraction — the whole-document LLM read that replaces per-section
 * classification. One document is read in full (chunked into outline-plus-view
 * slices along its top-level headings only when it exceeds the call budget, claims
 * unioned) and the model returns its testable claims plus per-section untestable
 * notes. The engine snaps every returned anchor against the live section index —
 * it never trusts a model-authored anchor.
 *
 * Views are cached individually (content-keyed, `guard/extract`), so a re-run
 * re-calls only the views whose text changed; a single-view doc caches like a
 * whole-doc read. The cache is derived/deletable, same pattern as the other
 * content-keyed KV stages.
 */

import { createHash } from 'node:crypto'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import { slugifyHeading, isOpenApiDoc } from '@truecourse/guard-runner'
import { planDocChunks } from '@truecourse/shared'
import {
  DocExtractionSchema,
  type DocExtraction,
  type ExtractedClaim,
  type UntestableNote,
} from './schemas.js'
import { EXTRACT_PROMPT_FINGERPRINT, type ExtractUserContext, type OutlineEntry } from './prompts.js'
import { flattenZodError, quoteInvalidOutput } from './validate.js'
import { suppressedQuotesIn, suppressionKey } from './suppression.js'
import type { ExtractRunner } from './runners.js'
import type { GuardDoc, SectionInput } from './section-plan.js'

export const EXTRACT_CACHE_NAME = 'guard/extract'

/**
 * Char budget per extraction view. Kept modest so each call stays fast and
 * parallelizes well: a view's latency is dominated by the claims it emits, so a
 * few small views beat one giant one. A document over budget splits along its
 * headings (see {@link planViews}).
 */
const EXTRACT_VIEW_BUDGET = 16_000

/** A document's snapped extraction: claims + notes both bound to live anchors. */
export interface DocClaims {
  claims: ExtractedClaim[]
  untestable: UntestableNote[]
}

/**
 * A document's extraction outcome. Views are independent: the union of the ones
 * that SUCCEEDED is returned, and `complete` is false when any view failed
 * (invalid output after one re-ask, or a thrown call). A failed view is not cached,
 * so the next run re-attempts only it. `ok: false` is reserved for a doc where
 * EVERY view failed — there is nothing to union.
 */
export type ExtractResult =
  | { ok: true; data: DocClaims; complete: boolean; failedViews: number }
  | { ok: false; reason: string }

/** One extraction view — a within-budget slice of the doc, with its position. */
interface ExtractView {
  text: string
  view?: { index: number; total: number }
}

/**
 * Cache key: extract prompt fingerprint + the view's content hash, PLUS the view's
 * stale-suppressed quotes (item 31) when any. The suppression component is
 * appended ONLY when non-empty, so a view with nothing suppressed keys exactly as
 * before item 31 (unaffected views keep their cache); a view that gains a
 * suppressed quote re-keys and re-extracts freshly with the "resolved stale" block
 * in its input. The base prompt (system prompt) never changes — suppression rides
 * the per-view input, not the fingerprint.
 */
function viewCacheKey(viewText: string, suppressed: readonly string[] = []): string {
  const base = `${EXTRACT_PROMPT_FINGERPRINT}::${sha(viewText)}`
  const suppression = suppressionKey(suppressed)
  return createHash('sha256').update(suppression ? `${base}::${suppression}` : base).digest('hex')
}

/** The subset of a doc's suppressed quotes that fall inside one view's text. */
function suppressedForView(doc: GuardDoc, viewText: string): string[] {
  return suppressedQuotesIn(viewText, doc.suppressedQuotes)
}

function sha(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** The outline (closed anchor set) a document's claims must pick from. */
function outlineOf(sections: SectionInput[]): OutlineEntry[] {
  return sections.map((s) => ({ anchor: s.anchor, headingText: s.headingText, level: s.level }))
}

/**
 * Plan a doc's extraction views via the shared heading-aware chunker
 * (`planDocChunks` — the same mechanism behind spec-scan's overlap windows).
 * One view when the whole doc fits; the full outline still travels with every
 * view, so a claim can always resolve its anchor regardless of which piece the
 * section's text landed in.
 */
function planViews(doc: GuardDoc): ExtractView[] {
  // OpenAPI docs are not markdown, so the heading-aware chunker would treat the
  // whole (potentially huge) file as ONE view and blow the call budget. Instead
  // chunk by OPERATION: one view per derived section, each carrying that
  // operation's canonical slice, with the full outline (every anchor) still the
  // snapping set — mirroring how a markdown outline travels with each chunk.
  if (isOpenApiDoc(doc.doc, doc.content)) {
    const secs = doc.sections
    if (secs.length <= 1) return [{ text: secs[0]?.fullText ?? doc.content }]
    return secs.map((s, i) => ({ text: s.fullText, view: { index: i + 1, total: secs.length } }))
  }
  const chunks = planDocChunks(doc.doc, doc.content, EXTRACT_VIEW_BUDGET)
  if (chunks.length === 1) return [{ text: chunks[0].text }]
  return chunks.map((c) => ({ text: c.text, view: { index: c.index, total: c.total } }))
}

/** How many extraction views a doc splits into (for the pre-flight estimate). */
export function countExtractViews(doc: GuardDoc): number {
  return planViews(doc).length
}

/** Whether every view of a doc is already cached (no LLM needed) — estimate use. */
export async function docExtractionCached(repoRoot: string, doc: GuardDoc): Promise<boolean> {
  for (const v of planViews(doc)) {
    if (!(await getCacheEntry(repoRoot, EXTRACT_CACHE_NAME, viewCacheKey(v.text, suppressedForView(doc, v.text))))) return false
  }
  return true
}

/** Count the uncached views of a doc — the exact extract-call count a run pays. */
export async function countUncachedExtractViews(repoRoot: string, doc: GuardDoc): Promise<number> {
  let n = 0
  for (const v of planViews(doc)) {
    if (!(await getCacheEntry(repoRoot, EXTRACT_CACHE_NAME, viewCacheKey(v.text, suppressedForView(doc, v.text))))) n++
  }
  return n
}

/** Run a per-view task, optionally through a shared concurrency limit. */
export type ConcurrencyLimit = <T>(fn: () => Promise<T>) => Promise<T>

/**
 * Extract one document's claims: read (cached) each view, union the claims and
 * notes of the views that SUCCEEDED, then snap every anchor against the live
 * section index. Views run in PARALLEL through the shared `limit` when provided (a
 * big doc's dozen views are dozens of independent LLM calls); the caller must not
 * also hold a slot for the doc, to avoid a nested-limit deadlock. A single view
 * that fails (invalid output after one re-ask, or a thrown/truncated call) no
 * longer nukes the whole document — it just lowers `complete`, so the caller keeps
 * the claims it got and re-attempts only the failed views next run. `ok: false`
 * only when EVERY view failed.
 */
export async function extractDocClaims(
  repoRoot: string,
  doc: GuardDoc,
  runner: ExtractRunner,
  limit?: ConcurrencyLimit,
  onView?: () => void,
): Promise<ExtractResult> {
  const outline = outlineOf(doc.sections)
  const views = planViews(doc)
  const run: ConcurrencyLimit = limit ?? ((fn) => fn())

  const attempts = await Promise.all(
    views.map((v) =>
      run(() => extractView(repoRoot, doc.doc, outline, v, suppressedForView(doc, v.text), runner)).then((got) => {
        onView?.()
        return got
      }),
    ),
  )

  const merged: DocExtraction = { claims: [], untestable: [] }
  let failedViews = 0
  let firstError = ''
  for (const got of attempts) {
    if ('error' in got) {
      failedViews++
      if (!firstError) firstError = got.error
    } else {
      merged.claims.push(...got.data.claims)
      merged.untestable.push(...got.data.untestable)
    }
  }
  if (failedViews === views.length) return { ok: false, reason: firstError || 'all extraction views failed' }
  return { ok: true, data: snap(merged, doc.sections), complete: failedViews === 0, failedViews }
}

type ViewAttempt = { data: DocExtraction } | { error: string }

/** A single view: cached result, else the LLM with one corrective re-ask. The
 *  view's stale-suppressed quotes (item 31) both re-key its cache and enter its
 *  input as a "resolved stale — extract no claim asserting this" block. */
async function extractView(
  repoRoot: string,
  docPath: string,
  outline: OutlineEntry[],
  view: ExtractView,
  suppressed: string[],
  runner: ExtractRunner,
): Promise<ViewAttempt> {
  const cacheKey = viewCacheKey(view.text, suppressed)
  const cached = await getCacheEntry(repoRoot, EXTRACT_CACHE_NAME, cacheKey)
  if (cached) {
    const parsed = DocExtractionSchema.safeParse(cached)
    if (parsed.success) return { data: parsed.data }
  }
  const ctx: ExtractUserContext = {
    doc: docPath,
    outline,
    viewText: view.text,
    view: view.view,
    ...(suppressed.length > 0 ? { suppressed } : {}),
  }
  const attempt = await callExtractWithReask(ctx, runner)
  if ('data' in attempt) await setCacheEntry(repoRoot, EXTRACT_CACHE_NAME, cacheKey, attempt.data)
  return attempt
}

/**
 * Call the extract runner and validate; on a schema failure re-ask ONCE with the
 * invalid output quoted back, then validate again. A thrown call is not re-asked.
 */
async function callExtractWithReask(ctx: ExtractUserContext, runner: ExtractRunner): Promise<ViewAttempt> {
  let raw: unknown
  try {
    raw = await runner(ctx)
  } catch (e) {
    return { error: `extraction call failed: ${(e as Error).message}` }
  }
  const parsed = DocExtractionSchema.safeParse(raw)
  if (parsed.success) return { data: parsed.data }

  let reRaw: unknown
  try {
    reRaw = await runner({ ...ctx, correction: { invalidOutput: quoteInvalidOutput(raw) } })
  } catch (e) {
    return { error: `extraction re-ask failed: ${(e as Error).message}` }
  }
  const reParsed = DocExtractionSchema.safeParse(reRaw)
  if (reParsed.success) return { data: reParsed.data }
  return { error: `extraction invalid after re-ask: ${flattenZodError(reParsed.error)}` }
}

// ---------------------------------------------------------------------------
// Anchor snapping + dedupe
// ---------------------------------------------------------------------------

/** Re-slugify a possibly-loose anchor path segment-by-segment. */
function reslug(anchor: string): string {
  return anchor
    .split('/')
    .filter(Boolean)
    .map((seg) => slugifyHeading(seg))
    .filter(Boolean)
    .join('/')
}

/**
 * Snap model-returned anchors onto the live section index and drop the rest.
 * Precedence: exact anchor; re-slugified path; unique leaf-segment match. A claim
 * whose anchor snaps to nothing is dropped (its section then shows as a coverage
 * gap — honest) rather than bound to the wrong place.
 */
function snap(raw: DocExtraction, sections: SectionInput[]): DocClaims {
  const valid = new Set(sections.map((s) => s.anchor))
  const bySlug = new Map<string, string>()
  const byLeaf = new Map<string, string[]>()
  for (const s of sections) {
    bySlug.set(reslug(s.anchor), s.anchor)
    const leaf = slugifyHeading(s.anchor.split('/').filter(Boolean).pop() ?? s.anchor)
    const list = byLeaf.get(leaf)
    if (list) list.push(s.anchor)
    else byLeaf.set(leaf, [s.anchor])
  }

  const snapAnchor = (rawAnchor: string): string | null => {
    if (valid.has(rawAnchor)) return rawAnchor
    const rs = reslug(rawAnchor)
    if (bySlug.has(rs)) return bySlug.get(rs)!
    const leaf = slugifyHeading(rawAnchor.split('/').filter(Boolean).pop() ?? rawAnchor)
    const cands = byLeaf.get(leaf)
    return cands && cands.length === 1 ? cands[0] : null
  }

  const claims: ExtractedClaim[] = []
  const seenClaim = new Set<string>()
  for (const c of raw.claims) {
    const anchor = snapAnchor(c.sectionAnchor)
    if (!anchor) continue
    const key = `${anchor}\0${c.driver}\0${c.claim.replace(/\s+/g, ' ').trim().toLowerCase()}`
    if (seenClaim.has(key)) continue
    seenClaim.add(key)
    claims.push({ ...c, sectionAnchor: anchor })
  }

  const untestable: UntestableNote[] = []
  const seenNote = new Set<string>()
  for (const n of raw.untestable) {
    const anchor = snapAnchor(n.sectionAnchor)
    if (!anchor || seenNote.has(anchor)) continue
    seenNote.add(anchor)
    untestable.push({ ...n, sectionAnchor: anchor })
  }

  return { claims, untestable }
}
