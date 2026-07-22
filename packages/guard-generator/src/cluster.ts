/**
 * Family clustering (item 4) — the cheap classification that groups a run's
 * tool-defect residue by SHARED ROOT MISTAKE so a burst of defects can be fixed once
 * instead of N times. After triage, the still-open tool-defect findings (weak fidelity
 * flags + generation-defect/environment triage that neither auto-resolved nor committed
 * as drift) are near-always a FEW mistakes repeated; ONE cheap call over their
 * one-sentence briefs returns the families, each with member indexes, a shared
 * correction the engine threads into a family re-author, and a plain-language
 * description for the escalation row.
 *
 * Output-only like every other guard stage: the runner returns the model's raw parsed
 * JSON and the engine Zod-validates it here with ONE corrective re-ask, then fail-soft
 * — a still-invalid or thrown call yields `null`, and the engine falls back to the
 * per-claim path (never a blocked run). NOT cached: it is one cheap call per run, fires
 * only when residue exists (rare), and its input (the whole residue set) rarely repeats.
 *
 * The clustering is a CLASSIFICATION over one-sentence briefs — no repo truth, no doc
 * content — so it runs on the sonnet tier, not the top-tier judgment models.
 */

import { z } from 'zod'
import { jsonSchemaHint, OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm'
import { createHash } from 'node:crypto'
import type { OutputCorrection } from './prompts.js'
import { quoteInvalidOutput } from './validate.js'

/** One family the model returns: the member indexes (into the input brief list), the
 *  shared correction the family re-author carries, and a one-line plain-language
 *  description of the recurring mistake for the escalation row. */
export const ClusterFamilySchema = z
  .object({
    members: z.array(z.number().int().nonnegative()).min(1),
    correction: z.string().min(1),
    description: z.string().min(1),
  })
  .strict()
export type ClusterFamily = z.infer<typeof ClusterFamilySchema>

/** The model's whole reply: zero or more families. Briefs the model judges unrelated
 *  are simply left out of every family (the engine re-authors only families ≥ 3). */
export const ClusterResponseSchema = z
  .object({
    families: z.array(ClusterFamilySchema),
  })
  .strict()
export type ClusterResponse = z.infer<typeof ClusterResponseSchema>

const CLUSTER_JSON_SCHEMA = jsonSchemaHint(ClusterResponseSchema)

function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

export const CLUSTER_SYSTEM_PROMPT = `\
You GROUP scenario-generation defect briefs by their SHARED ROOT MISTAKE. Each brief is
one sentence describing why ONE auto-generated test was rejected. A burst of rejections
is almost always a FEW mistakes repeated across many claims; your job is to find those
few patterns so each can be corrected ONCE. You return JSON only — no prose.

${OUTPUT_ONLY_GUARDRAIL}

# What a family is
A family is a set of briefs that describe the SAME underlying mistake — e.g. "asserted a
substring instead of the exact quoted output" across several claims, or "only exercised
the positive half of a two-sided claim" across several. Group by the SHAPE of the
mistake, not by the topic of the claim. Two briefs about different commands still belong
in one family when the mistake is the same.

# Rules
- Refer to briefs by their 0-based INDEX in the list below.
- Put a brief in AT MOST ONE family. A brief whose mistake is unique — it shares no
  pattern with any other — belongs to NO family: leave it out entirely (do not emit a
  family of one).
- For each family, write:
  - "correction": ONE imperative sentence telling an author how to avoid the shared
    mistake next time (this is threaded into a re-author of every member).
  - "description": ONE plain-language sentence naming the recurring defect, readable by
    someone who never saw the briefs (this labels a "tool limitation" row shown to the user).
- It is fine to return zero families when every brief is unrelated.

# Output schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition; your reply must validate
against it exactly. Output EXACTLY ONE JSON object, no prose, no fences:
${CLUSTER_JSON_SCHEMA}
Concretely — for 4 briefs where 0, 2, 3 share a mistake and 1 is unique:
  { "families": [
      { "members": [0, 2, 3],
        "correction": "Assert the exact output string the claim quotes, not a looser substring or effect-only check.",
        "description": "Scenarios assert a weaker proxy instead of the exact output the claim quotes." } ] }
Wrong (do NOT do this): prose around the JSON, a family of one, an out-of-range index,
or repeating a brief across two families.`

export const CLUSTER_PROMPT_FINGERPRINT = fingerprint(CLUSTER_SYSTEM_PROMPT)

export interface ClusterUserContext {
  /** The tool-defect briefs to cluster, one per residue finding (index-aligned). */
  briefs: string[]
  /** On a re-ask after invalid output, the prior output quoted back. */
  correction?: OutputCorrection
}

export function buildClusterUserPrompt(ctx: ClusterUserContext): string {
  const lines = [
    'DEFECT BRIEFS — group these by their shared root mistake (refer to each by its',
    '0-based index):',
    '',
  ]
  ctx.briefs.forEach((b, i) => lines.push(`[${i}] ${b}`))
  lines.push(
    '',
    'Return exactly one JSON object: { "families": [ { "members", "correction", "description" }, … ] }.',
  )
  if (ctx.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT valid. You returned:',
      ctx.correction.invalidOutput,
      'Return exactly ONE JSON object with a "families" array; each family has a',
      '"members" array of in-range 0-based indexes, a one-sentence "correction", and a',
      'one-sentence "description" — and NOTHING else.',
    )
  }
  return lines.join('\n')
}

/** The injectable clustering runner — output-only, returns the model's raw parsed JSON. */
export type ClusterRunner = (input: ClusterUserContext) => Promise<unknown>

/**
 * Cluster the tool-defect briefs into families. Fail-soft: a thrown or (after one
 * corrective re-ask) still-invalid call returns `null`, and the caller keeps the
 * per-claim path. Families whose member indexes fall out of range are dropped (never a
 * blocked run); a family is returned with its in-range indexes de-duplicated.
 */
export async function clusterDefects(briefs: string[], runner: ClusterRunner): Promise<ClusterFamily[] | null> {
  const response = await callClusterWithReask({ briefs }, runner)
  if (response === null) return null
  return response.families
    .map((fam) => ({ ...fam, members: inRangeDistinct(fam.members, briefs.length) }))
    .filter((fam) => fam.members.length > 0)
}

/** De-dupe (first-seen order) and drop any index not addressing a real brief. */
function inRangeDistinct(indexes: number[], count: number): number[] {
  const seen = new Set<number>()
  const out: number[] = []
  for (const i of indexes) {
    if (i >= 0 && i < count && !seen.has(i)) {
      seen.add(i)
      out.push(i)
    }
  }
  return out
}

async function callClusterWithReask(ctx: ClusterUserContext, runner: ClusterRunner): Promise<ClusterResponse | null> {
  let raw: unknown
  try {
    raw = await runner(ctx)
  } catch {
    return null
  }
  const first = ClusterResponseSchema.safeParse(raw)
  if (first.success) return first.data

  let reRaw: unknown
  try {
    reRaw = await runner({ ...ctx, correction: { invalidOutput: quoteInvalidOutput(raw) } })
  } catch {
    return null
  }
  const second = ClusterResponseSchema.safeParse(reRaw)
  // Fail-soft — a still-invalid cluster call is never load-bearing (the caller keeps
  // the per-claim path), so the reason is dropped rather than surfaced as an error.
  return second.success ? second.data : null
}
