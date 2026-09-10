import { prerequisiteProblems, type GuardPrerequisiteTarget, type GuardScenario } from '@truecourse/shared'
import {
  resolveDependencies,
  scenarioDependencyNames,
  dependencyBlockFor,
  type ResolvedDependencies,
  type DependencyBlock,
} from './dependencies.js'
import { loadResolvedExternals, resolveExternals, type ResolvedExternal } from './externals.js'
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
  const externals = loadResolvedExternals(repoRoot, declared, env)
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
      const value = resolveExternals(
        { [external.service]: declaration },
        {
          [external.service]: { baseUrl: dependency.env[declaration.baseUrlEnv], env: dependency.env },
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
  const environment = { ...preparationEnv, ...scenario.setup?.env }
  for (const step of scenario.steps) {
    if ('env' in step) Object.assign(environment, step.env)
    if ('boot' in step && typeof step.boot === 'object') Object.assign(environment, step.boot.env)
  }
  const problem = prerequisiteProblems(requirements, resolved.targets, environment)[0]
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
