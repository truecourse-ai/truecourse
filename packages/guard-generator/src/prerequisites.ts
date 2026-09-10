import { createHash } from 'node:crypto'
import { resolveApiServers, resolveWebSurface, type Recipe } from '@truecourse/guard-runner'
import { invocationProofGap } from './proof-grounding.js'
import {
  resolveGuardPrerequisite,
  prerequisiteProblems,
  scenarioMilestoneProof,
  type GuardFlow,
  type GuardDriverId,
  type GuardManifestGap,
  type GuardPrerequisite,
  type GuardPrerequisiteTarget,
  type GuardScenario,
  type ClaimNeed,
  type GuardVerification,
} from '@truecourse/shared'

/** Preserve legacy extracted requirements until a case explicitly refines them. */
export function bindClaimPrerequisites(
  verification: GuardVerification | undefined,
  needs: readonly ClaimNeed[],
  targets: readonly GuardPrerequisiteTarget[],
): GuardVerification | undefined {
  if (!verification?.cases) return verification
  const requirements = needs
    .filter((n) => n.kind === 'credential' || n.kind === 'external')
    .map((need) => {
      const exact = resolveGuardPrerequisite(need.name, targets)
      // Environment evidence is an explicit identifier, never a guessed suffix alias.
      const evidenced = targets.filter((t) =>
        t.credentialEnv.some((key) => need.detail?.split(/[^A-Za-z0-9_]+/).includes(key)),
      )
      const name =
        exact.kind === 'resolved' ? exact.target.name : evidenced.length === 1 ? evidenced[0].name : need.name
      return {
        dependency: name,
        mode: 'provided' as const,
        originalNames: [need.name],
        ...(need.detail ? { evidence: need.detail } : {}),
      }
    })
  return {
    ...verification,
    cases: verification.cases.map((c) => ({
      ...c,
      prerequisites: (c.prerequisites ?? requirements).map((p) => {
        const exact = resolveGuardPrerequisite(p.dependency, targets)
        const evidenced = targets.filter((t) =>
          t.credentialEnv.some((key) => p.evidence?.split(/[^A-Za-z0-9_]+/).includes(key)),
        )
        const name =
          exact.kind === 'resolved' ? exact.target.name : evidenced.length === 1 ? evidenced[0].name : p.dependency
        return {
          ...p,
          dependency: name,
          ...(name !== p.dependency ? { originalNames: [...new Set([...(p.originalNames ?? []), p.dependency])] } : {}),
        }
      }),
    })),
  }
}

export function scenarioCasePrerequisites(
  flow: GuardFlow,
  scenario: Pick<GuardScenario, 'steps'>,
): GuardPrerequisite[] {
  return scenarioMilestoneProof(scenario.steps).flatMap(
    (p) =>
      flow.milestones
        .find((m) => m.order === p.milestone)
        ?.verification?.cases?.filter((c) => !p.checks || p.checks.includes(c.id))
        .flatMap((c) => c.prerequisites ?? []) ?? [],
  )
}
export function bindScenarioPrerequisites(
  flow: GuardFlow,
  scenario: GuardScenario,
  targets: readonly GuardPrerequisiteTarget[],
): GuardScenario {
  const prerequisites = scenarioCasePrerequisites(flow, scenario).map((p) => {
    const resolved = resolveGuardPrerequisite(p.dependency, targets)
    return { ...p, dependency: resolved.kind === 'resolved' ? resolved.target.name : p.dependency }
  })
  if (!prerequisites.length) return scenario
  return {
    ...scenario,
    prerequisites,
    needs: [
      ...new Set([
        ...(scenario.needs ?? []),
        ...prerequisites.filter((p) => p.mode === 'provided').map((p) => p.dependency),
      ]),
    ],
  }
}
export function scenarioCasePrerequisiteProblems(
  flow: GuardFlow,
  scenario: Pick<GuardScenario, 'steps' | 'setup'>,
  targets: readonly GuardPrerequisiteTarget[],
  preparationEnv: Record<string, string> = {},
) {
  const environment = { ...preparationEnv, ...scenario.setup?.env }
  for (const step of scenario.steps) {
    if ('env' in step) Object.assign(environment, step.env)
    if ('boot' in step && typeof step.boot === 'object') Object.assign(environment, step.boot.env)
  }
  return prerequisiteProblems(scenarioCasePrerequisites(flow, scenario), targets, environment)
}

/** Shared runtime/estimate partition: eligibility changes the matcher input and key. */
export function partitionFlowPrerequisites(
  flow: GuardFlow,
  surface: GuardDriverId,
  targets: readonly GuardPrerequisiteTarget[],
  recipe: Recipe,
): { flow: GuardFlow; gaps: GuardManifestGap[] } {
  const gaps: GuardManifestGap[] = []
  const servers = resolveApiServers(recipe)
  const serve =
    surface === 'web'
      ? (resolveWebSurface(recipe)?.serve ?? [])
      : (servers.servers.get(servers.defaultServer)?.serve ?? [])
  const milestones = flow.milestones.flatMap((m) => {
    if (!m.verification?.cases) return [m]
    const cases = m.verification.cases.filter((c) => {
      if (c.invocation && (surface === 'web' || surface === 'api')) {
        const reason = invocationProofGap(c.invocation, serve)
        if (reason) {
          gaps.push({
            surface,
            kind: 'blocked-on',
            milestones: [m.order],
            obligations: [{ milestone: m.order, caseId: c.id }],
            reason,
            blocker: {
              kind: 'generation',
              action: 'Map an executor invocation that proves the documented command and address.',
            },
          })
          return false
        }
      }
      const problems = prerequisiteProblems(
        (c.prerequisites ?? []).filter((p) => p.mode === 'provided'),
        targets,
      )
      if (!problems.length) return true
      gaps.push({
        surface,
        kind: 'blocked-on',
        milestones: [m.order],
        obligations: [{ milestone: m.order, caseId: c.id }],
        reason: problems.map((p) => p.reason).join(' '),
        blocker: {
          kind: problems.every((p) => p.registerIn) ? 'configuration' : 'generation',
          dependencies: [...new Set(problems.filter((p) => p.registerIn).map((p) => p.dependency))],
          action: problems.every((p) => p.registerIn)
            ? 'Configure the named dependency, then regenerate this case.'
            : 'Resolve the extracted prerequisite to a declared service or dependency before generating this case.',
        },
      })
      return false
    })
    return cases.length ? [{ ...m, verification: { ...m.verification, cases } }] : []
  })
  const fingerprint =
    JSON.stringify(milestones) === JSON.stringify(flow.milestones)
      ? flow.fingerprint
      : createHash('sha256')
          .update(JSON.stringify([flow.fingerprint, milestones]))
          .digest('hex')
  return { flow: { ...flow, milestones, fingerprint }, gaps }
}

/** Account availability affects work selection; secret rotation never affects its hash. */
export function flowPrerequisiteStateMaterial(flow: GuardFlow, targets: readonly GuardPrerequisiteTarget[]): string {
  return JSON.stringify(
    flow.milestones.flatMap(
      (m) =>
        m.verification?.cases?.flatMap((c) =>
          (c.prerequisites ?? [])
            .filter((p) => p.mode === 'provided')
            .map((p) => {
              const resolved = resolveGuardPrerequisite(p.dependency, targets)
              return [p.dependency, resolved.kind === 'resolved' ? resolved.target.state : 'unknown']
            }),
        ) ?? [],
    ),
  )
}
