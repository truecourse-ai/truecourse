/**
 * Extraction suppression from section-scoped conflict resolutions (plan item 31).
 *
 * When a conflict is resolved by a SIDE verdict ("README is right"), the LOSER's
 * disputed sentence is stale: no claim asserting it may be extracted. This module
 * reads the spec corpus + the user's `specs/decisions.json` TOLERANTLY (the same
 * dependency-lean stance as section-plan's corpus read — a shape we don't
 * understand degrades to "nothing to suppress", never a failure) and runs the ONE
 * shared derivation ({@link suppressedClaims}) to produce, per losing doc, the
 * verbatim quotes extraction must not turn into claims.
 *
 * The derivation only ever names a quote for a resolution that MATCHES a currently
 * flagged conflict (a 'dismissed' verdict, or an orphaned resolution whose dispute
 * the corpus no longer flags, contributes nothing) — so a doc absent from the
 * returned map has nothing suppressed and its extraction is byte-identical to
 * before item 31.
 */

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { suppressedClaims, normalizeQuote, type SuppressedClaim } from '@truecourse/shared'

// Tolerant corpus view: just the areas' overlaps (docs + note + section pointers +
// spanned areas). Everything else in corpus.json is ignored; `.passthrough()`
// keeps unknown keys harmless.
const OverlapSectionShape = z
  .object({ doc: z.string(), heading: z.string().nullable().optional(), quote: z.string().optional() })
  .passthrough()
const OverlapShape = z
  .object({
    docs: z.tuple([z.string(), z.string()]),
    note: z.string().optional(),
    sections: z.array(OverlapSectionShape).optional(),
    areas: z.array(z.string()).optional(),
  })
  .passthrough()
const CorpusShape = z
  .object({
    areas: z.array(z.object({ id: z.string(), overlaps: z.array(OverlapShape).optional() }).passthrough()).optional(),
  })
  .passthrough()

const ConflictResolutionShape = z
  .object({
    docA: z.string(),
    anchorA: z.string().nullable().optional(),
    quoteA: z.string().optional(),
    docB: z.string(),
    anchorB: z.string().nullable().optional(),
    quoteB: z.string().optional(),
    verdict: z.enum(['a', 'b', 'dismissed']),
    resolvedAt: z.string().optional(),
    note: z.string().optional(),
  })
  .passthrough()
const DecisionsShape = z
  .object({
    manualExcludes: z.array(z.string()).optional(),
    conflictResolutions: z.array(ConflictResolutionShape).optional(),
  })
  .passthrough()

function readJsonTolerant<T>(file: string, schema: z.ZodType<T>): T | undefined {
  if (!fs.existsSync(file)) return undefined
  try {
    const parsed = schema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')))
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

/** The list of losing-side claims to suppress under the current resolutions. */
export function readSuppressedClaims(repoRoot: string): SuppressedClaim[] {
  const specDir = path.join(repoRoot, '.truecourse', 'specs')
  const corpus = readJsonTolerant(path.join(specDir, 'corpus.json'), CorpusShape)
  if (!corpus) return []
  const decisions = readJsonTolerant(path.join(specDir, 'decisions.json'), DecisionsShape)
  const corpusLike = {
    areas: (corpus.areas ?? []).map((a) => ({
      id: a.id,
      overlaps: (a.overlaps ?? []).map((o) => ({
        docs: o.docs,
        note: o.note,
        sections: (o.sections ?? []).map((s) => ({ doc: s.doc, heading: s.heading ?? null, quote: s.quote })),
        areas: o.areas,
      })),
    })),
  }
  const decisionsLike = {
    manualExcludes: decisions?.manualExcludes ?? [],
    conflictResolutions: (decisions?.conflictResolutions ?? []).map((r) => ({
      docA: r.docA,
      anchorA: r.anchorA ?? null,
      quoteA: r.quoteA,
      docB: r.docB,
      anchorB: r.anchorB ?? null,
      quoteB: r.quoteB,
      verdict: r.verdict,
      resolvedAt: r.resolvedAt,
      note: r.note,
    })),
  }
  return suppressedClaims(corpusLike, decisionsLike)
}

/**
 * The suppression index: losing doc → its verbatim stale quotes. Empty when no
 * side verdict currently suppresses anything, so callers that see an empty map (or
 * a doc absent from it) preserve every pre-item-31 cache key exactly.
 */
export function readSuppressionIndex(repoRoot: string): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const claim of readSuppressedClaims(repoRoot)) {
    const list = map.get(claim.doc)
    if (list) list.push(claim.quote)
    else map.set(claim.doc, [claim.quote])
  }
  return map
}

/**
 * The subset of a doc's suppressed quotes whose normalized text is CONTAINED in
 * `text` — the quotes relevant to one section or extraction view. Sorted +
 * de-duplicated (by normalized form) so the derived cache/fingerprint key is
 * stable regardless of resolution order. Empty ⇒ the caller changes no key.
 */
export function suppressedQuotesIn(text: string, docQuotes: readonly string[]): string[] {
  if (docQuotes.length === 0) return []
  const haystack = normalizeQuote(text)
  const seen = new Set<string>()
  const hits: string[] = []
  for (const q of docQuotes) {
    const needle = normalizeQuote(q)
    if (!needle || seen.has(needle) || !haystack.includes(needle)) continue
    seen.add(needle)
    hits.push(q)
  }
  return hits.sort((a, b) => (normalizeQuote(a) < normalizeQuote(b) ? -1 : 1))
}

/** A stable content key over a set of suppressed quotes (their normalized forms,
 *  sorted) — folded into extract cache keys / section fingerprints only when
 *  non-empty so unaffected views/sections keep their existing keys byte-for-byte. */
export function suppressionKey(quotes: readonly string[]): string {
  if (quotes.length === 0) return ''
  return [...quotes].map(normalizeQuote).sort().join('\x00')
}
