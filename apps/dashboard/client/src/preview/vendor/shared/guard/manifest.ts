// PREVIEW (UI mock, fake data): delete when the one-product dashboard lands. See docs/ONE_PRODUCT_PLAN.md §3.5.
// Copied from the agentic branch's packages/shared/src/guard/manifest.ts; delete with the preview.
/**
 * `scenarios/manifest.json`, the binding record for the committed scenarios, the
 * guard analogue of `contracts/manifest.json`. It is keyed by FLOW (v2): each
 * entry names the flow, the milestone composition it was generated against, the
 * sections it binds, the scenarios that realize it (each with the drivers its steps
 * exercise), the generation-inputs hash that makes an unchanged flow a no-op, and
 * the per-surface gaps that explain a missing scenario.
 *
 * Per-SECTION coverage derives at read time from the flows' bindings, see
 * {@link guardManifestSections}.
 *
 * It travels with the repo (committable, like the scenarios themselves). At run
 * time it is informational, binding truth is the scenarios' own `binds` checked
 * against the live section index, not this file.
 */

import { z } from 'zod'
import { GuardDriverIdSchema, type GuardDriverId } from './drivers'
import { GuardFlowBindingSchema } from './flows'
import { GuardCoverageGapKindSchema, GuardScenarioDiagnosisSchema } from './report'
import { GuardTestStatusSchema } from './result'

/**
 * A section's testability verdict, the same shape the classifier LLM returns
 * and the generator records. `driver` names which driver a scenario could be
 * authored for (`cli` proceeds today; `api`/`web`/`tui` are recorded for the
 * future); `untestable` marks a section no driver can assert. Both carry a plain
 * one-sentence reason so a non-cli/untestable outcome is a visible coverage gap.
 * The driver set is the guard driver registry, a new driver joins by adding a
 * registry row, never by editing this enum.
 */
export const GuardTestabilityVerdictSchema = z.union([
  z.object({ driver: GuardDriverIdSchema, reason: z.string() }).strict(),
  z.object({ untestable: z.literal(true), reason: z.string() }).strict(),
])
export type GuardTestabilityVerdict = z.infer<typeof GuardTestabilityVerdictSchema>

/**
 * Fold a LEGACY single-`surface` row into the step-derived `drivers` list. Rows
 * were written that way until 2026-08-12, when the scenario-level driver was
 * retired: a scenario mixing cli and web steps recorded `surface: cli` and every
 * per-driver tally read from it was wrong for exactly that scenario. The manifest
 * is committed, so old rows keep loading, as a one-driver list, which is what
 * `surface` always meant. Nothing writes `surface` again.
 */
function foldLegacySurface(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (!('surface' in value)) return value
  const { surface, ...rest } = value as Record<string, unknown>
  return 'drivers' in rest ? rest : { ...rest, drivers: [surface] }
}

/** One scenario realizing a flow, and the drivers its STEPS exercise. */
export const GuardManifestScenarioSchema = z.preprocess(
  foldLegacySurface,
  z
    .object({
      id: z.string().min(1),
      /**
       * The drivers the scenario's steps exercise, in registry order, what
       * {@link guardScenarioDrivers} reads off the committed file. A scenario that
       * drives the UI and then reads the result over HTTP records BOTH, so every
       * per-driver count is a union over the scenarios that actually touch it.
       */
      drivers: z.array(GuardDriverIdSchema).min(1),
      /**
       * The test's status as of the generate that wrote it: `failing` when it failed
       * its birth execution (committed anyway, the code and the doc disagree),
       * else `passing`. It is the INVENTORY status, so a read renders a red test
       * without `guard/result.json`; a `guard run` outcome always wins over it.
       * Defaults to `passing` so manifests written before failing tests were
       * committed parse unchanged.
       */
      status: GuardTestStatusSchema.default('passing'),
      /**
       * The diagnosis a FAILING test commits with, see
       * {@link GuardScenarioDiagnosisSchema} for the durability contract. Present
       * whenever a generate that records diagnoses committed the test failing; absent
       * on passing scenarios and on manifests written before it existed (their red
       * tests fall back to the prior report's carried rows).
       */
      diagnosis: GuardScenarioDiagnosisSchema.optional(),
    })
    .strict(),
)
export type GuardManifestScenario = z.infer<typeof GuardManifestScenarioSchema>

/**
 * Why a flow has no scenario on one surface, the coverage gap, scoped to the
 * surface it happened on. Same kinds (and the same `driver` discriminator for
 * `awaiting-driver`) as the generate report's gaps.
 */
export const GuardManifestGapSchema = z
  .object({
    /** The surface the gap is about. */
    surface: GuardDriverIdSchema,
    kind: GuardCoverageGapKindSchema,
    reason: z.string(),
    /** Present iff `kind === 'awaiting-driver'`, the non-runnable driver awaited. */
    driver: GuardDriverIdSchema.optional(),
  })
  .strict()
  .refine((g) => (g.kind === 'awaiting-driver') === (g.driver !== undefined), {
    message: 'awaiting-driver gaps carry a driver; other kinds carry none',
  })
export type GuardManifestGap = z.infer<typeof GuardManifestGapSchema>

/**
 * The interfaces ONE surface's realization plan referenced for a flow, the
 * spec→code link as the MATCHER drew it, recorded whether or not a scenario was
 * ever written.
 *
 * Without it, interface usage could only be read back off the written scenarios,
 * so a flow that matched interfaces but was refused at authoring (blocked-on a
 * capability the repo hasn't declared) left those interfaces looking untouched by
 * any spec. This is the planning record, not the realization record: the
 * scenarios array above still says what actually exists.
 */
export const GuardManifestFlowInterfacesSchema = z
  .object({
    /** The surface whose plan referenced them. */
    surface: GuardDriverIdSchema,
    /** Interface ids the plan walks, in first-use order. */
    interfaceIds: z.array(z.string().min(1)),
  })
  .strict()
export type GuardManifestFlowInterfaces = z.infer<typeof GuardManifestFlowInterfacesSchema>

export const GuardManifestFlowSchema = z
  .object({
    /** The flow's id in `scenarios/flows.json`. */
    flowId: z.string().min(1),
    /** The flow's milestone-composition fingerprint at generation time. */
    flowFingerprint: z.string().min(1),
    /** The sections the flow binds (doc + anchor + section fingerprint). */
    bindings: z.array(GuardFlowBindingSchema),
    /** The scenarios realizing the flow, one per surface it was authored for. */
    scenarios: z.array(GuardManifestScenarioSchema),
    /**
     * Per-surface interfaces the realization PLAN referenced, written for every
     * surface that got a plan, authored or blocked. Defaults to `[]` so a manifest
     * written before this field still parses (the interfaces read then falls back to
     * the written scenarios' own refs).
     */
    interfaces: z.array(GuardManifestFlowInterfacesSchema).default([]),
    /** Hash of the inputs the generator used; unset until a generator authors. */
    generationInputsHash: z.string().nullable().default(null),
    /** Per-surface gaps: why a surface has no scenario. */
    gaps: z.array(GuardManifestGapSchema).default([]),
    /**
     * True when no synthesized flow claims this entry any more, the flow left
     * `scenarios/flows.json`, but its committed scenarios are real coverage, so
     * the entry (and its files) are carried forward and MARKED. Absent means the
     * entry is still derived from the specs.
     *
     * An entry that is orphaned AND carries no scenario is never written: with
     * neither a flow nor a test behind it, it is stale bookkeeping, so
     * `guard generate` prunes it and its gaps die with it.
     */
    orphaned: z.boolean().optional(),
  })
  .strict()
export type GuardManifestFlow = z.infer<typeof GuardManifestFlowSchema>

/** Drop the retired top-level `version` marker (pre-2026-08-13 writers stamp it)
 *  before the strict body sees it, so mixed-version stores keep loading. */
function dropLegacyVersion(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (!('version' in value)) return value
  const { version: _legacy, ...rest } = value as Record<string, unknown>
  return rest
}

export const GuardManifestSchema = z.preprocess(
  dropLegacyVersion,
  z
    .object({
      flows: z.array(GuardManifestFlowSchema),
    })
    .strict(),
)
export type GuardManifest = z.infer<typeof GuardManifestSchema>

/**
 * THE SETTLE INVARIANT, the surfaces the entry PLANNED (a realization plan
 * existed, so `interfaces` records the path it walks) but accounts for with NEITHER
 * a committed test NOR a gap. Empty ⇒ the invariant holds.
 *
 * A settled flow (one carrying a `generationInputsHash`) is skipped by every
 * future generate, so an unaccounted surface is a coverage hole that can never
 * heal by itself: no test, no stated reason, and nothing left to re-run it.
 */
export function unaccountedSurfaces(flow: GuardManifestFlow): GuardDriverId[] {
  const accounted = new Set<GuardDriverId>([
    ...flow.scenarios.flatMap((s) => s.drivers),
    ...flow.gaps.map((g) => g.surface),
  ])
  return flow.interfaces.map((j) => j.surface).filter((surface) => !accounted.has(surface))
}

/**
 * True when the entry is SETTLED (its hash makes it a no-op) yet leaves a planned
 * surface unaccounted for. Such an entry is treated as WORK by the next generate -
 * its hash is disregarded, so an existing hole re-runs with no migration.
 */
export function violatesSettleInvariant(flow: GuardManifestFlow): boolean {
  return flow.generationInputsHash !== null && unaccountedSurfaces(flow).length > 0
}

/**
 * One live section's manifest coverage, DERIVED from the flow-keyed manifest, the
 * per-section pivot the coverage surfaces join on (sections stay the staleness
 * anchor). Never persisted: `guardManifestSections` recomputes it per read.
 */
export interface GuardManifestSectionView {
  /** Repo-relative path of the spec document. */
  doc: string
  /** Slugified heading path (the section anchor). */
  anchor: string
  /** `sha256:…` over the normalized section text the flows bound against. */
  fingerprint: string
  /** Ids of the flows binding this section, in manifest order. */
  flowIds: string[]
  /** Ids of every scenario those flows are realized by, sorted. */
  scenarioIds: string[]
  /** The bound flows' generation-inputs hash when they agree on one; else null. */
  generationInputsHash: string | null
}

/**
 * Project the flow-keyed manifest onto its sections: one view per bound (doc,
 * anchor), unioning the flows that bind it and the scenarios those flows are
 * realized by. Sorted by doc then anchor.
 */
export function guardManifestSections(manifest: GuardManifest | null): GuardManifestSectionView[] {
  const byKey = new Map<string, GuardManifestSectionView & { hashes: Set<string | null> }>()
  for (const flow of manifest?.flows ?? []) {
    for (const binding of flow.bindings) {
      const key = `${binding.doc}\0${binding.anchor}`
      let view = byKey.get(key)
      if (!view) {
        view = {
          doc: binding.doc,
          anchor: binding.anchor,
          fingerprint: binding.fingerprint,
          flowIds: [],
          scenarioIds: [],
          generationInputsHash: null,
          hashes: new Set(),
        }
        byKey.set(key, view)
      }
      view.flowIds.push(flow.flowId)
      for (const s of flow.scenarios) view.scenarioIds.push(s.id)
      view.hashes.add(flow.generationInputsHash)
    }
  }
  return [...byKey.values()]
    .map(({ hashes, ...view }) => ({
      ...view,
      scenarioIds: [...new Set(view.scenarioIds)].sort(),
      generationInputsHash: hashes.size === 1 ? [...hashes][0] : null,
    }))
    .sort((a, b) => a.doc.localeCompare(b.doc) || a.anchor.localeCompare(b.anchor))
}
