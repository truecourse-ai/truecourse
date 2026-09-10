import { resolveGuardPrerequisite, scenarioPrerequisiteProblems, type GuardPrerequisiteTarget, type GuardScenario } from '@truecourse/shared'
import {
  resolveDependencies,
  scenarioDependencyNames,
  dependencyBlockFor,
  registeredEnvironment,
  type ResolvedDependencies,
  type DependencyBlock,
} from './dependencies.js'
import { loadExternalsLocal, resolveExternals, externalsInjectEnv, externalsSecrets, type ResolvedExternal } from './externals.js'
import type { RecipeApiExternal } from './recipe.js'
import { externalsLocalPath } from './store.js'

/** One resolution supplies both the dependency gate and the account environment. */
export function resolvePrerequisites(
  repoRoot: string,
  declared?: Record<string, RecipeApiExternal>,
  input: ResolvedDependencies = resolveDependencies(repoRoot),
  env: NodeJS.ProcessEnv = process.env,
) {
  const dependencies = {
    ...input,
    dependencies: input.dependencies.map((d) => ({ ...d, requirements: [...d.requirements] })),
  }
  const local = loadExternalsLocal(repoRoot)
  const externals = resolveExternals(declared, local, env)
  const targets: GuardPrerequisiteTarget[] = dependencies.dependencies
    .filter((d) => d.state !== null)
    .map((d) => ({
      name: d.name,
      state: d.state!,
      aliases: d.entry.services ?? [],
      registerIn: dependencies.localPath,
      protectedEnv: d.requirements.map((r) => r.field),
      credentialEnv: d.requirements.filter((r) => r.secret && !r.optional).map((r) => r.field),
    }))
  const resolvedExternals: ResolvedExternal[] = []
  for (const external of externals) {
    const associated = dependencies.dependencies.filter(
      (d) => d.state !== null && d.entry.services?.includes(external.service),
    )
    if (associated.length > 1) {
      // Canonical and alias bindings both stop when ownership is ambiguous.
      for (const dependency of associated) {
        const target = targets.find((t) => t.name === dependency.name)!
        target.state = 'incomplete'
        dependency.state = 'incomplete'
        dependency.requirements.push({
          field: external.service,
          resolved: false,
          secret: false,
          reason: `Multiple catalog entries claim ${external.service}; choose one registration owner.`,
        })
      }
      continue
    }
    if (associated.length === 1) {
      const dependency = associated[0]
      const target = targets.find((t) => t.name === dependency.name)
      if (!target) continue
      const declaration = declared![external.service]
      const registered = new Set(dependency.entry.registration?.kind === 'env'
        ? dependency.entry.registration.vars.map(variable => variable.name) : [])
      const serviceLocal = local[external.service]
      const value = resolveExternals(
        { [external.service]: declaration },
        {
          [external.service]: {
            // Catalog fields belong to the registration. Service-only URLs
            // retain the overlay written by hosted dependency registration.
            baseUrl: registered.has(declaration.baseUrlEnv)
              ? dependency.env[declaration.baseUrlEnv] : serviceLocal?.baseUrl,
            env: dependency.env,
            endpoints: Object.fromEntries(Object.keys(declaration.endpoints ?? {})
              .map((key) => [key, registered.has(key) ? dependency.env[key] : serviceLocal?.endpoints?.[key]] as const)
              .filter((entry): entry is readonly [string, string] => entry[1] !== undefined)),
          },
        },
        {},
      )[0]
      target.protectedEnv = [...new Set([...(target.protectedEnv ?? []), ...value.requirements.map((r) => r.envVar)])]
      target.credentialEnv = [
        ...new Set([...target.credentialEnv, ...value.requirements.filter((r) => r.secret).map((r) => r.envVar)]),
      ]
      if (target.state === 'provided' && value.state !== 'provided') target.state = 'incomplete'
      for (const requirement of value.requirements.filter(
        (r) => !r.resolved && !dependency.requirements.some((existing) => existing.field === r.envVar),
      )) {
        dependency.requirements.push({
          field: requirement.envVar,
          resolved: false,
          secret: requirement.secret,
          reason: `The ${external.service} declaration requires ${requirement.envVar}; update the ${dependency.name} registration to supply it.`,
        })
      }
      resolvedExternals.push(value)
    } else {
      targets.push({
        name: external.service,
        state: external.state,
        aliases: [],
        registerIn: externalsLocalPath(repoRoot),
        protectedEnv: external.requirements.map((r) => r.envVar),
        credentialEnv: external.requirements.filter((r) => r.secret).map((r) => r.envVar),
      })
      resolvedExternals.push(external)
    }
  }
  for (const dependency of dependencies.dependencies) {
    const target = targets.find((t) => t.name === dependency.name)
    if (target) dependency.state = target.state
  }
  return {
    targets,
    externals: resolvedExternals.map((external) => {
      const target = targets.find((t) => t.name === external.service || t.aliases.includes(external.service))
      return target && target.state !== 'provided'
        ? { ...external, state: target.state, inject: {}, secrets: [], endpoints: [] }
        : external
    }),
    dependencies,
  }
}
export type ResolvedPrerequisites = ReturnType<typeof resolvePrerequisites>

/** The same selected accounts feed preparation, execution, and evidence redaction. */
export function scenarioAccountEnvironment(scenario: GuardScenario, resolved: ResolvedPrerequisites) {
  const env = externalsInjectEnv(resolved.externals)
  const secrets = externalsSecrets(resolved.externals)
  const names = new Set(scenarioDependencyNames(scenario).map(name => {
    const match = resolveGuardPrerequisite(name, resolved.targets)
    return match.kind === 'resolved' ? match.target.name : name
  }))
  for (const dependency of resolved.dependencies.dependencies) {
    if (!names.has(dependency.name) || dependency.state !== 'provided' || dependency.entry.registration?.kind !== 'env') continue
    Object.assign(env, registeredEnvironment(dependency.env))
    for (const requirement of dependency.requirements) {
      const value = dependency.env[requirement.field]
      if (requirement.secret && value) secrets.set(`${dependency.name}.${requirement.field}`, value)
    }
  }
  for (const prerequisite of scenario.prerequisites ?? []) {
    if (prerequisite.mode !== 'absent') continue
    const match = resolveGuardPrerequisite(prerequisite.dependency, resolved.targets)
    if (match.kind !== 'resolved') continue
    for (const key of match.target.credentialEnv) {
      if (scenario.setup?.env?.[key] === '') env[key] = ''
    }
  }
  return { env, secrets }
}

export function scenarioPrerequisiteBlock(
  scenario: GuardScenario,
  resolved: ResolvedPrerequisites,
  preparationEnv: Record<string, string> = {},
): DependencyBlock | null {
  const requirements = [...(scenario.prerequisites ?? [])]
  for (const name of scenarioDependencyNames(scenario)) {
    // Step-created records need no account gate.
    if (resolved.dependencies.dependencies.some((d) => d.name === name && d.state === null)) continue
    if (!requirements.some((r) => r.dependency === name)) requirements.push({ dependency: name, mode: 'provided' })
  }
  const problem = scenarioPrerequisiteProblems(requirements, resolved.targets, scenario, preparationEnv)[0]
  if (problem) {
    const catalogBlock = dependencyBlockFor(
      { ...scenario, needs: [problem.dependency], prerequisites: undefined, steps: [] },
      resolved.dependencies,
    )
    if (catalogBlock && resolved.dependencies.dependencies.some((d) => d.name === problem.dependency))
      return catalogBlock
  }
  return problem
    ? {
        dependency: problem.dependency,
        requirement: problem.reason,
        detail: problem.reason,
        needs: [],
        registerIn: problem.registerIn ?? resolved.dependencies.catalogPath,
      }
    : null
}
