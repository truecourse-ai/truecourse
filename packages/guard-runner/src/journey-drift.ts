/**
 * Journey drift — the run-time check that a scenario's grounding still matches the
 * live code surface. A generated scenario embeds the journey path it was authored
 * from plus each journey's fingerprint; the mapping snapshot
 * (`.truecourse/guard/journeys.json`) carries the fingerprints the surface derives
 * TODAY.
 *
 * A mismatch is an ANNOTATION, never an outcome: the scenario's steps are frozen
 * and remain a valid probe of the spec claims it binds, so a moved surface only
 * suggests re-generating. Spec drift (the `binds` fingerprints) is the loud signal;
 * this one is a dot.
 */

import type { GuardScenario, JourneysFile } from '@truecourse/shared'

/**
 * True when the scenario's embedded journey grounding no longer matches `catalog`:
 * a referenced journey id is gone from the catalog, or its fingerprint moved. Also
 * true when the scenario's own `path`/`fingerprints` arrays disagree in length —
 * a ref with no fingerprint to check cannot be shown un-drifted.
 *
 * False (no annotation) whenever there is nothing to compare: the scenario carries
 * no journey refs (hand-written), or no catalog snapshot exists.
 */
export function isJourneyDrifted(
  scenario: Pick<GuardScenario, 'journey'>,
  catalog: JourneysFile | null,
): boolean {
  const ref = scenario.journey
  if (!ref || !catalog) return false
  const byId = new Map(catalog.journeys.map((j) => [j.id, j.fingerprint]))
  return ref.path.some((id, i) => {
    const live = byId.get(id)
    const embedded = ref.fingerprints[i]
    return live === undefined || embedded === undefined || live !== embedded
  })
}
