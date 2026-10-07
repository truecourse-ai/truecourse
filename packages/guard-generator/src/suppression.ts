/**
 * Claim suppression from conflict resolutions.
 *
 * When a conflict is resolved by a SIDE verdict ("README is right"), the LOSER's
 * disputed sentence is stale: a claim read from it enters no flow. This module
 * reads the spec corpus + the user's `specs/decisions.json` TOLERANTLY (a shape
 * we don't understand degrades to "nothing to suppress", never a failure) and
 * runs the ONE shared derivation ({@link suppressedClaims}) to produce the
 * losing sentences, each by its key.
 *
 * The derivation only ever names a sentence for a resolution that MATCHES a
 * currently flagged conflict (a 'dismissed' verdict, or an orphaned resolution
 * whose conflict the corpus no longer flags, contributes nothing).
 */

import fs from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import { suppressedClaims, type SuppressedClaim } from '@truecourse/shared'
import { specsDir } from '@truecourse/shared/work-tree'

// Tolerant corpus view: just the areas' conflicts (docs + note + sides +
// spanned areas). Everything else in corpus.json is ignored; `.passthrough()`
// keeps unknown keys harmless.
const ConflictSideShape = z
  .object({
    doc: z.string(),
    heading: z.string().nullable().optional(),
    quote: z.string().optional(),
    sentence: z.string(),
  })
  .passthrough()
const ConflictShape = z
  .object({
    docs: z.tuple([z.string(), z.string()]),
    note: z.string().optional(),
    sections: z.array(ConflictSideShape).optional(),
    areas: z.array(z.string()).optional(),
  })
  .passthrough()
const CorpusShape = z
  .object({
    areas: z.array(z.object({ id: z.string(), conflicts: z.array(ConflictShape).optional() }).passthrough()).optional(),
  })
  .passthrough()

const ConflictResolutionShape = z
  .object({
    docA: z.string(),
    anchorA: z.string().nullable().optional(),
    quoteA: z.string().optional(),
    sentenceA: z.string(),
    docB: z.string(),
    anchorB: z.string().nullable().optional(),
    quoteB: z.string().optional(),
    sentenceB: z.string(),
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
  const specDir = specsDir(repoRoot)
  const corpus = readJsonTolerant(path.join(specDir, 'corpus.json'), CorpusShape)
  if (!corpus) return []
  const decisions = readJsonTolerant(path.join(specDir, 'decisions.json'), DecisionsShape)
  const corpusLike = {
    areas: (corpus.areas ?? []).map((a) => ({
      id: a.id,
      conflicts: (a.conflicts ?? []).map((o) => ({
        docs: o.docs,
        note: o.note,
        // The sentence is part of a side's identity: dropping it would merge
        // conflicts that share two sections, and match the wrong verdict.
        sections: (o.sections ?? []).map((s) => ({
          doc: s.doc,
          heading: s.heading ?? null,
          quote: s.quote,
          sentence: s.sentence,
        })),
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
      sentenceA: r.sentenceA,
      docB: r.docB,
      anchorB: r.anchorB ?? null,
      quoteB: r.quoteB,
      sentenceB: r.sentenceB,
      verdict: r.verdict,
      resolvedAt: r.resolvedAt,
      note: r.note,
    })),
  }
  return suppressedClaims(corpusLike, decisionsLike)
}
