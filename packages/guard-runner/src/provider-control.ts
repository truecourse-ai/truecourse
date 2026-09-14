import {
  GUARD_PROVIDER_CONTROL_OPERATIONS, guardProviderTargets, resolveGuardPrerequisiteNormalized,
  type GuardDriverId, type GuardPrerequisiteTarget, type GuardProviderControl, type GuardScenario,
} from '@truecourse/shared'
import type { Recipe } from './recipe.js'
import { preparationOwnedEnvKeys } from './preparation-postgres.js'

export const PROVIDER_CONTROL_VERSION = 2

export type ResolvedProviderControl = { problem: string } | { service: string; realization: 'proxy' | 'stub'; baseUrlEnvs: string[]; credentialEnv: string[]; operations: string[] }

/** The resolver is shared by authoring, estimates and execution. It contains no account values. */
export function resolveProviderControl(control: GuardProviderControl, driver: GuardDriverId, targets: readonly GuardPrerequisiteTarget[], recipe: Recipe): ResolvedProviderControl {
  const providers = guardProviderTargets(targets)
  const resolution = resolveGuardPrerequisiteNormalized(control.service, providers)
  if (resolution.kind !== 'resolved') return { problem: `Provider ${control.service} matches ${resolution.kind === 'ambiguous' ? 'multiple declarations' : 'no declared external service'}. Declare its recipe base URL variable.` } as const
  const target = resolution.target
  const declaration = recipe.api?.externals?.[target.name]
  if (!declaration) return { problem: `Provider ${target.name} has no recipe base URL mapping.` } as const
  if (driver !== 'api' && driver !== 'web') return { problem: `Provider control is unsupported on the ${driver} driver.` } as const
  if (control.operations.some(op => !GUARD_PROVIDER_CONTROL_OPERATIONS.includes(op))) return { problem: `Provider ${target.name} requires an unsupported control operation.` } as const
  return {
    service: target.name,
    realization: target.state === 'provided' ? 'proxy' : 'stub',
    baseUrlEnvs: [declaration.baseUrlEnv, ...Object.keys(declaration.endpoints ?? {})].sort(),
    credentialEnv: [...target.credentialEnv].sort(),
    operations: [...control.operations].sort(),
  } as const
}

export function providerControlStateMaterial(controls: readonly GuardProviderControl[], driver: GuardDriverId, targets: readonly GuardPrerequisiteTarget[], recipe: Recipe): string {
  return JSON.stringify([PROVIDER_CONTROL_VERSION, controls.map(c => resolveProviderControl(c, driver, targets, recipe))])
}

/** Reject a draft that would pass without observing its named controlled provider. */
export function scenarioProviderControlProblems(controls: readonly GuardProviderControl[], driver: GuardDriverId, targets: readonly GuardPrerequisiteTarget[], recipe: Recipe, scenario: Pick<GuardScenario, 'setup'>): string[] {
  const problems: string[] = []
  for (const control of controls) {
    const resolved = resolveProviderControl(control, driver, targets, recipe)
    if ('problem' in resolved) { problems.push(resolved.problem); continue }
    const profile = scenario.setup?.preparation && recipe.preparations?.[scenario.setup.preparation]
    if (profile && resolved.baseUrlEnvs.some(key => preparationOwnedEnvKeys(profile).has(key))) {
      problems.push(`Provider ${resolved.service} cannot override a preparation-owned binding.`)
      continue
    }
    const minimumCalls = control.operations.includes('sequence') ? 2 : control.operations.some(op => op !== 'call-count') ? 1 : 0
    if (resolved.realization === 'proxy') {
      const script = scenario.setup?.externals?.[resolved.service]
      if (script?.unmatched !== 'error' || script.calls === undefined) problems.push(`Provider ${resolved.service} requires setup.externals with unmatched: error and an exact calls assertion.`)
      if (script?.calls !== undefined && script.calls < minimumCalls) problems.push(`Provider ${resolved.service} requires at least ${minimumCalls} observed call(s) to prove its control operations.`)
      if (script?.faults?.some(f => !f.respond && !f.refuse)) problems.push(`Controlled provider ${resolved.service} must script every reply or refusal; passthrough is not controlled evidence.`)
      if (resolved.baseUrlEnvs.some(key => scenario.setup?.env?.[key] !== undefined)) problems.push(`Provider ${resolved.service} must use its selected proxy, without an endpoint override.`)
    } else {
      const stubNames = new Set<string>()
      for (const key of resolved.baseUrlEnvs) {
        const binding = scenario.setup?.env?.[key]?.match(/^\$\{HTTP_STUB:([A-Za-z0-9_-]+)\}$/)
        if (binding) stubNames.add(binding[1])
        const stub = binding && scenario.setup?.http?.[binding[1]]
        if (!stub || stub.unmatched === '404' || !stub.routes.every(r => r.calls !== undefined)) {
          problems.push(`Provider ${resolved.service} requires ${key} wired to an isolated setup.http stub with strict unmatched handling and exact route calls.`)
        }
      }
      const calls = [...stubNames].reduce((n, name) => n + (scenario.setup?.http?.[name]?.routes.reduce((n, r) => n + (r.calls ?? 0), 0) ?? 0), 0)
      if (calls < minimumCalls) problems.push(`Provider ${resolved.service} requires at least ${minimumCalls} observed call(s) to prove its control operations.`)
    }
  }
  return problems
}
