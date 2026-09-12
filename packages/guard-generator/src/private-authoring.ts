import { preparationCatalog, scenarioDependencyNames, type Recipe } from '@truecourse/guard-runner'
import type { GuardScenario } from '@truecourse/shared'

/** Eligibility is deliberately narrower than general preparation support: a
 * private database does not isolate a supplied account or an external service. */
export function privateAuthoringProfiles(recipe: Recipe, localDependencies: ReadonlySet<string>): Set<string> {
  return new Set(preparationCatalog(recipe).filter(({ name }) => {
    const profile = recipe.preparations![name]!
    return profile.postgres?.isolation === 'database' && profile.needs !== undefined &&
      profile.needs.every(name => localDependencies.has(name))
  }).map(profile => profile.name))
}

export function privateAuthoringDefect(
  scenario: GuardScenario,
  profiles: ReadonlySet<string>,
  localDependencies: ReadonlySet<string>,
): string | undefined {
  if (!scenario.setup?.preparation || !profiles.has(scenario.setup.preparation))
    return 'select an eligible private Postgres preparation with only local dependencies'
  const shared = scenarioDependencyNames(scenario).find(name => !localDependencies.has(name))
  if (shared) return `dependency "${shared}" is not isolated by the private database`
  return undefined
}
