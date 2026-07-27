/**
 * JOURNEYS — the code-side unit (HOW to test), derived deterministically from the
 * app's own surfaces (commands, routes, screens) with no LLM in the loop. A
 * journey is an entry-rooted interaction path over ONE surface; a scenario is one
 * spec flow realized through a journey path.
 *
 * Shared (not under `guard/`) because the analyze side renders the same shape.
 * The catalog snapshot lives at `.truecourse/guard/journeys.json` — gitignored and
 * re-derived from the working tree; the clone-portable part is the journey
 * FINGERPRINTS embedded in scenario YAMLs and the manifest.
 *
 * The step vocabulary is ONE envelope across every surface: a closed union keyed
 * by `kind`, so an api or web extractor lands additively (no new step schema, no
 * format event). A journey's `type` is a driver-registry id — the driver that
 * would execute its scenarios.
 */

import crypto from 'node:crypto'
import { z } from 'zod'
import { GuardDriverIdSchema } from './guard/drivers.js'

/** The closed step vocabulary, shared by every surface. */
export const JourneyStepKindSchema = z.enum([
  'invoke',
  'request',
  'navigate',
  'input',
  'activate',
])
export type JourneyStepKind = z.infer<typeof JourneyStepKindSchema>

/** Run a command (cli / tui): the argv PATH plus the flags that command accepts. */
export const JourneyInvokeStepSchema = z
  .object({
    kind: z.literal('invoke'),
    /** Argv path of the command, e.g. `["tasks", "add"]` — never the binary path. */
    command: z.array(z.string()).min(1),
    /** Flags the command accepts, e.g. `["--json", "--force"]`. */
    flags: z.array(z.string()).default([]),
    /** Human one-liner for display; cosmetic — never fingerprinted. */
    label: z.string().optional(),
  })
  .strict()

/** One HTTP request (api): the operation's method + path template. */
export const JourneyRequestStepSchema = z
  .object({
    kind: z.literal('request'),
    method: z.string().min(1),
    /** Path template as the surface declares it, e.g. `/tasks/:id`. */
    path: z.string().min(1),
    label: z.string().optional(),
  })
  .strict()

/** Move to a screen (web / desktop / mobile): the route as the surface declares it. */
export const JourneyNavigateStepSchema = z
  .object({
    kind: z.literal('navigate'),
    route: z.string().min(1),
    label: z.string().optional(),
  })
  .strict()

/** Put a value into a field — the target as the surface names it. */
export const JourneyInputStepSchema = z
  .object({
    kind: z.literal('input'),
    target: z.string().min(1),
    label: z.string().optional(),
  })
  .strict()

/** Click / tap / submit — the target as the surface names it. */
export const JourneyActivateStepSchema = z
  .object({
    kind: z.literal('activate'),
    target: z.string().min(1),
    label: z.string().optional(),
  })
  .strict()

export const JourneyStepSchema = z.discriminatedUnion('kind', [
  JourneyInvokeStepSchema,
  JourneyRequestStepSchema,
  JourneyNavigateStepSchema,
  JourneyInputStepSchema,
  JourneyActivateStepSchema,
])
export type JourneyInvokeStep = z.infer<typeof JourneyInvokeStepSchema>
export type JourneyRequestStep = z.infer<typeof JourneyRequestStepSchema>
export type JourneyNavigateStep = z.infer<typeof JourneyNavigateStepSchema>
export type JourneyInputStep = z.infer<typeof JourneyInputStepSchema>
export type JourneyActivateStep = z.infer<typeof JourneyActivateStepSchema>
export type JourneyStep = z.infer<typeof JourneyStepSchema>

/** The surface-visible root of a journey — the cli command path it starts from. */
export const JourneyEntrySchema = z
  .object({
    /** Argv path the journey is rooted at — at least one token (a root journey is
     *  rooted at the program's own command name). Never the resolved binary path. */
    command: z.array(z.string()).min(1),
  })
  .strict()
export type JourneyEntry = z.infer<typeof JourneyEntrySchema>

export const JourneySchema = z
  .object({
    /** `<type>/<slug>`, e.g. `cli/tasks-add`. */
    id: z.string().min(1),
    /** The surface — a driver-registry id (the driver that would run its scenarios). */
    type: GuardDriverIdSchema,
    title: z.string().min(1),
    entry: JourneyEntrySchema,
    steps: z.array(JourneyStepSchema).min(1),
    /** `sha256:…` over the surface-visible shape — see {@link journeyFingerprint}. */
    fingerprint: z.string().min(1),
  })
  .strict()
export type Journey = z.infer<typeof JourneySchema>

/**
 * How ONE surface's catalog was derived: `tree` = the analyzer's own artifacts
 * (the primary path, every surface), `probes` = the cli fallback ladder for a
 * framework no extractor recognizes. A degradation marker, not a quality claim.
 */
export const JourneyCatalogSourceSchema = z.enum(['tree', 'probes'])
export type JourneyCatalogSource = z.infer<typeof JourneyCatalogSourceSchema>

/** `.truecourse/guard/journeys.json` — the last mapping's catalog (gitignored). */
export const JourneysFileSchema = z
  .object({
    version: z.literal(1),
    /** ISO timestamp of the mapping run that wrote the file. */
    generatedAt: z.string(),
    /** The recipe fingerprint the mapping ran against. */
    recipeFingerprint: z.string(),
    journeys: z.array(JourneySchema),
    /** Per journey TYPE (a driver-registry id) → how that catalog was derived. */
    source: z.record(z.string(), JourneyCatalogSourceSchema).optional(),
  })
  .strict()
export type JourneysFile = z.infer<typeof JourneysFileSchema>

/** Whitespace-normalized token — the section-fingerprint rule, per field. */
function normalizeToken(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * A step's fingerprinted identity: its kind plus the SURFACE-VISIBLE payload —
 * the command path and its flag set, the method + path template, the route, the
 * target. `label` is cosmetic and never folded in. Flags fold as a SET (sorted):
 * which flags a command accepts is the surface, the order help prints them is not.
 */
function stepIdentity(step: JourneyStep): string {
  switch (step.kind) {
    case 'invoke':
      return [
        step.kind,
        step.command.map(normalizeToken).join(' '),
        [...step.flags].map(normalizeToken).sort().join(' '),
      ].join('\u0000')
    case 'request':
      return [step.kind, normalizeToken(step.method).toUpperCase(), normalizeToken(step.path)].join('\u0000')
    case 'navigate':
      return [step.kind, normalizeToken(step.route)].join('\u0000')
    default:
      return [step.kind, normalizeToken(step.target)].join('\u0000')
  }
}

/**
 * `sha256:<hex>` over a journey's SURFACE-VISIBLE shape: its type, its entry
 * descriptor, and each step's kind + payload — never internal symbol names, file
 * paths, or the call chain behind the surface. A rename/move refactor that leaves
 * what a user can reach unchanged must not move a single fingerprint, or every
 * refactor sprays drift dots across the scenario corpus and the signal dies of
 * alarm fatigue.
 */
export function journeyFingerprint(
  journey: Pick<Journey, 'type' | 'entry' | 'steps'>,
): string {
  const body = [
    journey.type,
    journey.entry.command.map(normalizeToken).join(' '),
    ...journey.steps.map(stepIdentity),
  ].join('\n')
  return `sha256:${crypto.createHash('sha256').update(body, 'utf-8').digest('hex')}`
}
