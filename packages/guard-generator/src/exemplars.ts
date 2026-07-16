/**
 * Support-claim exemplar packs (item 9): a quantified "supports/handles/compatible
 * with X" claim promises thousands of inputs the doc never enumerates, so the
 * engine GENERATES a diverse corpus of X inputs and runs the documented operation
 * over it. This module owns that single generation call — its diversity prompt, its
 * output schema, and `seedSupportPack`, which mirrors item 8's `seedInvariantPack`
 * but fills the pack from the model instead of the section's own blocks.
 *
 * The generation is content-cached under `guard/exemplars` on the claim's identity +
 * the prompt fingerprint + the pack size, so a re-generate re-materializes the SAME
 * pack (a no-op while the claim stands) without a second LLM call. `writePack`
 * preserves any `user`-source file already in the pack, so a hand-added real-world
 * repro survives regeneration (the ratchet). A generation that can't complete
 * (thrown or still-invalid after one re-ask) fails with its concrete reason — the
 * claim's section errors with it and unsettles, re-attempted next run — never a
 * pack-less scenario and never a swallowed cause.
 */

import { createHash } from 'node:crypto'
import { getCacheEntry, setCacheEntry } from '@truecourse/llm'
import { writePack } from '@truecourse/guard-runner'
import type { GuardPackManifest, GuardPackFile } from '@truecourse/shared'
import { jsonSchemaHint, OUTPUT_ONLY_GUARDRAIL } from '@truecourse/shared/llm'
import { z } from 'zod'
import { anchorLeaf } from './serialize.js'
import { flattenZodError, quoteInvalidOutput } from './validate.js'
import type { ExtractedClaim, SupportSubject } from './schemas.js'
import type { SectionInput } from './section-plan.js'
import type { OutputCorrection } from './prompts.js'

export const EXEMPLAR_CACHE_NAME = 'guard/exemplars'

/** Default exemplars a support pack is generated with; the `TRUECOURSE_SUPPORT_PACK_SIZE`
 *  env overrides it (mirrors `TRUECOURSE_GENERATE_BATCH`). A modest pack keeps the
 *  single generation call cheap while sampling enough grammar corners to be useful. */
export const DEFAULT_SUPPORT_PACK_SIZE = 40

/** The configured support-pack size — the env override, else {@link DEFAULT_SUPPORT_PACK_SIZE}. */
export function defaultSupportPackSize(): number {
  const env = process.env.TRUECOURSE_SUPPORT_PACK_SIZE
  if (env) {
    const n = parseInt(env, 10)
    if (Number.isFinite(n) && n >= 1) return n
  }
  return DEFAULT_SUPPORT_PACK_SIZE
}

// ---------------------------------------------------------------------------
// Output schema — what the model returns
// ---------------------------------------------------------------------------

/** One generated exemplar: a complete, standalone input in the supported class, plus
 *  an optional one-line note on which grammar corner it exercises (kept as per-file
 *  provenance in the pack manifest). */
export const ExemplarSchema = z.object({
  content: z.string().min(1),
  note: z.string().min(1).optional(),
})

/** The model's whole reply: a non-empty array of diverse exemplars. */
export const ExemplarPackSchema = z
  .object({
    exemplars: z.array(ExemplarSchema).min(1),
  })
  .strict()
export type ExemplarPack = z.infer<typeof ExemplarPackSchema>

const EXEMPLAR_JSON_SCHEMA = jsonSchemaHint(ExemplarPackSchema)

function fingerprint(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 16)
}

// ---------------------------------------------------------------------------
// The diversity prompt (self-contained, optimized for Sonnet)
// ---------------------------------------------------------------------------

export const EXEMPLAR_SYSTEM_PROMPT = `\
You write a DIVERSE CORPUS of inputs in a stated language, dialect, format, or
syntax. A tool documents that it SUPPORTS this class of input; your corpus is what
the tool will be run over to check that promise. Your ONE job is BREADTH: sample the
grammar's corners so a real support gap is likely to land on at least one of your
inputs. You return JSON only — no prose.

${OUTPUT_ONLY_GUARDRAIL}

# What each exemplar is
Each exemplar is ONE complete, standalone, SYNTACTICALLY VALID input in the requested
class — the kind of thing the tool is documented to accept. Not a fragment, not a
diff, not commentary: a whole document/snippet that stands on its own. Every exemplar
must be VALID (the support promise is about valid inputs the tool should handle), so
never emit deliberately malformed input.

# Diversity is the whole point
Do NOT return N near-identical inputs. Spread them across the grammar's real corners
so the set as a whole exercises the feature surface:
- the common, boring cases AND the rarely-written ones;
- edge tokens: empty/minimal forms, deeply nested forms, long/wide forms, unusual but
  legal literals (numbers with leading/trailing dots, unicode, escapes, quoting
  variants), whitespace and comment variations the grammar allows;
- every distinct construct the class is known for — if it is a query dialect, vary
  clauses and operators; if a data format, vary value types and nesting; if a language
  syntax, vary the statement/expression forms.
Each exemplar should be MEANINGFULLY different from the others.

# Faithful to the class
Write ONLY in the requested class. Do not switch languages, add explanatory prose
inside the input, or wrap the input in fences — "content" is the raw input bytes,
exactly as a file of that type would contain them.

# How many
Return the requested COUNT of exemplars (a few over or under is fine; strong diversity
matters more than an exact tally). Never fewer than a handful.

# Output schema (CANONICAL)
This JSON Schema is generated from the engine's Zod definition; your reply must
validate against it exactly. Output EXACTLY ONE JSON object, no prose, no fences:
${EXEMPLAR_JSON_SCHEMA}
Concretely — for "the JSON data format", count 4 (right shape, genuinely diverse):
  { "exemplars": [
      { "content": "{}", "note": "empty object" },
      { "content": "[1, 2.5, -3e10, true, null]", "note": "mixed scalar array incl. exponent" },
      { "content": "{\\"nested\\": {\\"a\\": [{\\"b\\": \\"\\\\u00e9\\"}]}}", "note": "deep nesting + unicode escape" },
      { "content": "\\"just a string\\"", "note": "bare top-level string" } ] }
Wrong (do NOT do this): prose around the JSON, fenced code blocks in "content", four
near-identical inputs, or any invalid/malformed input.`

export const EXEMPLAR_PROMPT_FINGERPRINT = fingerprint(EXEMPLAR_SYSTEM_PROMPT)

export interface ExemplarUserContext {
  /** The class of thing supported — language | dialect | format | syntax. */
  kind: SupportSubject['kind']
  /** The named subject X the corpus is written in (e.g. "the Postgres SQL dialect"). */
  subject: string
  /** The support claim's sentence, for context on what "supported" means here. */
  claim: string
  /** How many diverse exemplars to write. */
  count: number
  /** On a re-ask after invalid output, the prior output quoted back. */
  correction?: OutputCorrection
}

export function buildExemplarUserPrompt(ctx: ExemplarUserContext): string {
  const lines = [
    `Class: ${ctx.kind}`,
    `Subject (X): ${ctx.subject}`,
    `Support claim being tested: ${ctx.claim}`,
    '',
    `Write ${ctx.count} DIVERSE, valid exemplars in ${ctx.subject}, each exercising a`,
    'different corner of the grammar. Return exactly one JSON object: { "exemplars": [ … ] }.',
  ]
  if (ctx.correction) {
    lines.push(
      '',
      'CORRECTION — your previous response was NOT valid. You returned:',
      ctx.correction.invalidOutput,
      'Return exactly ONE JSON object with an "exemplars" array of { "content", "note" }',
      'objects, each "content" a complete valid input, and NOTHING else.',
    )
  }
  return lines.join('\n')
}

/** The injectable exemplar runner — output-only, returns the model's raw parsed JSON. */
export type ExemplarRunner = (input: ExemplarUserContext) => Promise<unknown>

// ---------------------------------------------------------------------------
// Pack id + cache key
// ---------------------------------------------------------------------------

/**
 * A deterministic, filesystem-safe pack id for a support claim: `sup-<leaf>-<hash>`,
 * keyed on the claim's IDENTITY (doc + anchor + claim text) so a re-generate reuses
 * the SAME pack directory — its user-added files then survive (the ratchet), exactly
 * as {@link import('./invariant.js').invariantPackId} does for invariant packs.
 */
export function supportPackId(section: SectionInput, claimText: string): string {
  const hash = createHash('sha256')
    .update([section.doc, section.anchor, claimText.replace(/\s+/g, ' ').trim()].join('\0'))
    .digest('hex')
    .slice(0, 8)
  return `sup-${anchorLeaf(section.anchor)}-${hash}`
}

/** Per-claim exemplar cache key: it moves with the claim identity, the subject, the
 *  pack size, and the generation prompt — so a re-generate with the same claim +
 *  size is a cache hit (no LLM call), and a changed size/subject/prompt regenerates. */
function exemplarCacheKey(section: SectionInput, claimText: string, subject: SupportSubject, count: number): string {
  return createHash('sha256')
    .update(
      [
        EXEMPLAR_PROMPT_FINGERPRINT,
        section.doc,
        section.anchor,
        claimText.replace(/\s+/g, ' ').trim(),
        subject.kind,
        subject.subject,
        subject.extension ?? '',
        String(count),
      ].join('::'),
    )
    .digest('hex')
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

/** The pack-relative filename of the n-th generated exemplar: `exemplar-NN`, with the
 *  subject's extension when it has one (cosmetic — the runner stages content, not the
 *  name — but it reads clearly in the committed corpus). */
function exemplarFileName(index: number, extension?: string): string {
  const stem = `exemplar-${String(index + 1).padStart(2, '0')}`
  return extension ? `${stem}.${extension.replace(/^\./, '')}` : stem
}

type ExemplarCallResult = { ok: true; pack: ExemplarPack } | { ok: false; reason: string }

async function callExemplarWithReask(ctx: ExemplarUserContext, runner: ExemplarRunner): Promise<ExemplarCallResult> {
  let raw: unknown
  try {
    raw = await runner(ctx)
  } catch (e) {
    return { ok: false, reason: `exemplar call failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  const first = ExemplarPackSchema.safeParse(raw)
  if (first.success) return { ok: true, pack: first.data }

  let reRaw: unknown
  try {
    reRaw = await runner({ ...ctx, correction: { invalidOutput: quoteInvalidOutput(raw) } })
  } catch (e) {
    return { ok: false, reason: `exemplar re-ask failed: ${e instanceof Error ? e.message : String(e)}` }
  }
  const second = ExemplarPackSchema.safeParse(reRaw)
  if (second.success) return { ok: true, pack: second.data }
  return { ok: false, reason: `exemplar output invalid after re-ask: ${flattenZodError(second.error)}` }
}

/** A seed outcome: the materialized pack id, or the failure's actual reason —
 *  surfaced verbatim in the section's authoring error (never swallowed). */
export type SupportSeedResult = { ok: true; packId: string } | { ok: false; reason: string }

/**
 * Seed a support claim's exemplar pack. The generated exemplars are cached
 * content-keyed on the claim identity + prompt + size, so a re-generate
 * re-materializes the SAME pack with NO second LLM call while the claim stands.
 * `writePack` overwrites the `seed`-source files but PRESERVES any `user`-source
 * file already in the pack — a hand-added repro survives regeneration. A
 * generation that can't complete fails with its concrete reason; the claim's
 * section then errors and unsettles, re-attempted next run.
 */
export async function seedSupportPack(
  repoRoot: string,
  section: SectionInput,
  claim: ExtractedClaim,
  runner: ExemplarRunner,
  packSize: number,
): Promise<SupportSeedResult> {
  const subject = claim.support
  if (!subject) return { ok: false, reason: 'support claim carries no subject payload' }
  const count = Math.max(1, packSize)
  const cacheKey = exemplarCacheKey(section, claim.claim, subject, count)

  let pack: ExemplarPack | null = null
  const cached = await getCacheEntry(repoRoot, EXEMPLAR_CACHE_NAME, cacheKey)
  if (cached) {
    const parsed = ExemplarPackSchema.safeParse(cached)
    if (parsed.success) pack = parsed.data
  }
  if (!pack) {
    const generated = await callExemplarWithReask(
      { kind: subject.kind, subject: subject.subject, claim: claim.claim, count },
      runner,
    )
    if (!generated.ok) return generated
    pack = generated.pack
    await setCacheEntry(repoRoot, EXEMPLAR_CACHE_NAME, cacheKey, pack)
  }

  // Materialize the pack. `writePack` overwrites the seed files (identical bytes on a
  // cache hit — no git churn) and PRESERVES any user-added file, so the write is safe
  // to run every generate: it re-seeds a deleted pack and keeps the ratchet honest.
  const packId = supportPackId(section, claim.claim)
  const files: Record<string, string> = {}
  const manifestFiles: GuardPackFile[] = []
  pack.exemplars.forEach((ex, i) => {
    const name = exemplarFileName(i, subject.extension)
    files[name] = ex.content
    manifestFiles.push({ name, source: 'seed', ...(ex.note ? { note: ex.note } : {}) })
  })
  const manifest: GuardPackManifest = {
    pack: packId,
    provenance:
      `generated exemplar pack for ${subject.subject} (support claim ${section.doc}#${section.anchor}); ` +
      `drop real-world repros here and mark them "source":"user" in pack.json to keep them across regeneration`,
    files: manifestFiles,
  }
  writePack(repoRoot, manifest, files)
  return { ok: true, packId }
}
