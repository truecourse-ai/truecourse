/**
 * `scenarios/manifest.json` — the binding record for the committed scenarios,
 * the guard analogue of `contracts/manifest.json`. One entry per bound section:
 * its anchor, the section fingerprint the scenarios were written against, the
 * scenario ids that guard it, and a slot for the generation-inputs hash the
 * generator stamps when it authors scenarios.
 *
 * It travels with the repo (committable, like the scenarios themselves). At run
 * time it is informational — binding truth is the scenarios' own `binds` checked
 * against the live section index, not this file.
 */

import { z } from 'zod'
import { GUARD_FORMAT_VERSION } from './scenario.js'
import { GuardDriverIdSchema } from './drivers.js'

/**
 * A section's testability verdict — the same shape the classifier LLM returns
 * and the generator records. `driver` names which driver a scenario could be
 * authored for (`cli` proceeds today; `api`/`web`/`tui` are recorded for the
 * future); `untestable` marks a section no driver can assert. Both carry a plain
 * one-sentence reason so a non-cli/untestable outcome is a visible coverage gap.
 * The driver set is the guard driver registry — a new driver joins by adding a
 * registry row, never by editing this enum.
 */
export const GuardTestabilityVerdictSchema = z.union([
  z.object({ driver: GuardDriverIdSchema, reason: z.string() }).strict(),
  z.object({ untestable: z.literal(true), reason: z.string() }).strict(),
])
export type GuardTestabilityVerdict = z.infer<typeof GuardTestabilityVerdictSchema>

export const GuardManifestSectionSchema = z
  .object({
    /** Repo-relative path of the spec document. */
    doc: z.string().min(1),
    /** Slugified heading path (the section anchor). */
    anchor: z.string().min(1),
    /** `sha256:…` over the normalized section text at authorship time. */
    fingerprint: z.string().min(1),
    /** Ids of the scenarios bound to this section. */
    scenarioIds: z.array(z.string()),
    /** Hash of the inputs a generator used to author these scenarios; unset until then. */
    generationInputsHash: z.string().nullable().default(null),
    /**
     * The section's classification outcome from the last generate. Present once a
     * generator has classified it; absent for sections recorded only by
     * `rebuildManifestFromScenarios`. A non-cli/untestable verdict is a visible
     * coverage gap the dashboard surfaces.
     */
    classification: GuardTestabilityVerdictSchema.optional(),
  })
  .strict()
export type GuardManifestSection = z.infer<typeof GuardManifestSectionSchema>

export const GuardManifestSchema = z
  .object({
    guard: z.literal(GUARD_FORMAT_VERSION),
    sections: z.array(GuardManifestSectionSchema),
  })
  .strict()
export type GuardManifest = z.infer<typeof GuardManifestSchema>
