/**
 * Interface drift — the run-time check that a scenario's grounding still matches the
 * live code surface. A generated scenario embeds the interface path it was authored
 * from plus each interface's fingerprint; the catalog carries the fingerprints the
 * surface has TODAY.
 *
 * The catalog to compare against is the MERGED one (`readMergedInterfaceCatalog`),
 * never the derived half alone: an id this predicate cannot find counts as drift,
 * and the surfaces nobody derives live in the committed
 * `guard/interfaces.authored.json`. Half a catalog reads as half the repo moving.
 *
 * A mismatch is an ANNOTATION, never an outcome: the scenario's steps are frozen
 * and remain a valid probe of the spec claims it binds, so a moved surface only
 * suggests re-generating. Spec drift (the `binds` fingerprints) is the loud signal;
 * this one is a dot.
 */

import type { GuardScenario, InterfacesFile } from '@truecourse/shared'

/**
 * True when the scenario's embedded interface grounding no longer matches `catalog`:
 * a referenced interface id is gone from the catalog, or its fingerprint moved. Also
 * true when the scenario's own `path`/`fingerprints` arrays disagree in length —
 * a ref with no fingerprint to check cannot be shown un-drifted.
 *
 * False (no annotation) whenever there is nothing to compare: the scenario carries
 * no interface refs (hand-written), or no catalog snapshot exists.
 */
export function isInterfaceDrifted(
  scenario: Pick<GuardScenario, 'interface'>,
  catalog: InterfacesFile | null,
): boolean {
  const ref = scenario.interface
  if (!ref || !catalog) return false
  const byId = new Map(catalog.interfaces.map((j) => [j.id, j.fingerprint]))
  return ref.path.some((id, i) => {
    const live = byId.get(id)
    const embedded = ref.fingerprints[i]
    return live === undefined || embedded === undefined || live !== embedded
  })
}
