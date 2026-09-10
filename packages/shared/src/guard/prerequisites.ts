import { z } from 'zod'

/** Account requirements belong to individual cases, including their setup steps. */
export const GuardPrerequisiteSchema = z
  .object({
    dependency: z.string().min(1),
    mode: z.enum(['provided', 'absent']),
    evidence: z.string().min(1).optional(),
    originalNames: z.array(z.string().min(1)).optional(),
  })
  .strict()
export type GuardPrerequisite = z.infer<typeof GuardPrerequisiteSchema>

export interface GuardPrerequisiteTarget {
  name: string
  state: 'provided' | 'incomplete' | 'unprovided'
  aliases: readonly string[]
  registerIn: string
  /** Credential variable names only; never values. */
  credentialEnv: readonly string[]
  protectedEnv?: readonly string[]
}

/** Exact declared associations only. Ambiguous aliases deliberately do not resolve. */
export function resolveGuardPrerequisite(
  name: string,
  targets: readonly GuardPrerequisiteTarget[],
): { kind: 'resolved'; target: GuardPrerequisiteTarget } | { kind: 'unknown' | 'ambiguous'; dependency: string } {
  const matches = targets.filter((t) => t.name === name || t.aliases.includes(name))
  return matches.length === 1
    ? { kind: 'resolved', target: matches[0] }
    : { kind: matches.length ? 'ambiguous' : 'unknown', dependency: name }
}

export function prerequisiteProblems(
  requirements: readonly GuardPrerequisite[],
  targets: readonly GuardPrerequisiteTarget[],
  env?: Readonly<Record<string, string>>,
): { dependency: string; reason: string; registerIn?: string }[] {
  const problems: { dependency: string; reason: string; registerIn?: string }[] = []
  for (const requirement of requirements) {
    const resolved = resolveGuardPrerequisite(requirement.dependency, targets)
    if (resolved.kind !== 'resolved') {
      problems.push({
        dependency: requirement.dependency,
        reason: `${resolved.kind} prerequisite: ${requirement.dependency}`,
      })
      continue
    }
    const target = resolved.target
    if (
      requirements.some(
        (r) =>
          r.mode !== requirement.mode &&
          (() => {
            const other = resolveGuardPrerequisite(r.dependency, targets)
            return other.kind === 'resolved' && other.target.name === target.name
          })(),
      )
    ) {
      problems.push({
        dependency: target.name,
        reason: `Conflicting provided and absent requirements for ${target.name}.`,
      })
    } else if (requirement.mode === 'provided' && target.state !== 'provided') {
      problems.push({
        dependency: target.name,
        reason: `Requires a provided ${target.name} account (${target.state}).`,
        registerIn: target.registerIn,
      })
    } else if (
      requirement.mode === 'absent' &&
      (!target.credentialEnv.length || target.credentialEnv.some((key) => env?.[key] !== ''))
    ) {
      problems.push({
        dependency: target.name,
        reason: `Explicitly clear the declared credential variables for ${target.name} in scenario setup.env to test absent credentials.`,
      })
    } else if (
      requirement.mode === 'provided' &&
      (target.protectedEnv ?? target.credentialEnv).some((key) => env && Object.hasOwn(env, key))
    ) {
      problems.push({
        dependency: target.name,
        reason: `The scenario must not override the provided ${target.name} account.`,
      })
    }
  }
  return problems
}
