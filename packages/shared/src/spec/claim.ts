/**
 * A CLAIM: one thing a document states, read from one to three of its
 * sentences, with a verdict on whether an outside observer could check it
 * against the running product. The scan compares claims to find where two
 * documents disagree; test generation writes tests for the testable ones; the
 * dashboard lists them.
 *
 * A claim's identity is its document and the keys of the sentences it is read
 * from, the same rule a conflict's side goes by, so an unchanged sentence keeps
 * its claim across rescans and a reworded one gets a new claim; two claims read
 * from the same sentences are told apart by their order. Everything else on it
 * is what the extraction read.
 */

import { z } from 'zod'
import { shortHash } from './conflict-resolution.js'

/** Why a claim cannot be checked from outside the product. */
export const ClaimUntestableReasonSchema = z.enum([
  // The sentence only says something may or can happen, without saying when.
  'hedge',
  // A recommendation about using the product, not a statement of how it behaves.
  'advice',
  // A sample value or output that illustrates, not a rule.
  'example',
  // What a document covers, or where to read on.
  'navigation',
  // How the team works: releases, contributions, support.
  'process',
  // Licence terms and legal statements.
  'legal',
  // An internal detail nothing outside the product shows.
  'not-observable',
])
export type ClaimUntestableReason = z.infer<typeof ClaimUntestableReasonSchema>

export const ClaimSchema = z
  .object({
    id: z.string().min(1),
    /** The document it is read from, by ref. */
    doc: z.string().min(1),
    /** The keys of the sentences it is read from, in document order; the identity. */
    sentences: z.array(z.string().min(1)).min(1),
    /** The product thing the claim is about, as the product names it. */
    subject: z.string().min(1),
    /** One declarative sentence that can be read alone. */
    statement: z.string().min(1),
    /** Its areas, as canonical area ids. */
    areas: z.array(z.string()),
    /** Whether a test could check it, or why not. */
    testable: z.union([z.literal(true), z.object({ reason: ClaimUntestableReasonSchema }).strict()]),
  })
  .strict()
export type Claim = z.infer<typeof ClaimSchema>

export const CLAIMS_FILE_VERSION = 1

/** Every claim the scan read from a workspace's documents. */
export const ClaimsFileSchema = z
  .object({
    version: z.literal(CLAIMS_FILE_VERSION),
    generatedAt: z.string(),
    claims: z.array(ClaimSchema),
  })
  .strict()
export type ClaimsFile = z.infer<typeof ClaimsFileSchema>

const CLAIM_ID_PREFIX = 'claim::'

/**
 * A claim's id: its doc and the hash of its sentence keys, order-free, with a
 * doc-order ordinal when more than one claim is read from the same sentences
 * (a sentence that states two facts yields two claims).
 */
export function claimId(doc: string, sentences: readonly string[], repeat = 0): string {
  const base = `${CLAIM_ID_PREFIX}${doc}::${shortHash([...sentences].sort().join('\x00'))}`
  return repeat > 0 ? `${base}-${repeat + 1}` : base
}

export function isClaimId(id: string): boolean {
  return id.startsWith(CLAIM_ID_PREFIX)
}
