import { createHash } from 'node:crypto'
import { resolveApiServers, resolveWebSurface, resolveProviderControl, providerControlStateMaterial, scenarioProviderControlProblems, type Recipe } from '@truecourse/guard-runner'
import { invocationProofGap } from './proof-grounding.js'
import {
  resolveGuardPrerequisite,
  resolveGuardPrerequisiteNormalized,
  prerequisiteProblems,
  scenarioPrerequisiteProblems,
  scenarioMilestoneProof,
  verificationCapabilityGap,
  verificationRequirements,
  GUARD_OBSERVATION_CAPABILITIES,
  type GuardFlow,
  type GuardDriverId,
  type GuardManifestGap,
  type GuardPrerequisite,
  type GuardPrerequisiteTarget,
  type GuardScenario,
  type ClaimNeed,
  type GuardVerification,
  guardProviderTargets,
} from '@truecourse/shared'

/** Resolve case requirements; claim-wide needs supply identifiers, never case scope. */
export function bindClaimPrerequisites(
  verification: GuardVerification | undefined,
  needs: readonly ClaimNeed[],
  targets: readonly GuardPrerequisiteTarget[],
): GuardVerification | undefined {
  if (!verification?.cases) return verification
  const requirements = needs
    .filter((n) => n.kind === 'credential' || n.kind === 'external')
    .map((need) => {
      const resolved = resolveGuardPrerequisiteNormalized(need.name, targets)
      // Environment evidence is an explicit identifier, never a guessed suffix alias.
      const evidenced = targets.filter((t) =>
        t.credentialEnv.some((key) => need.detail?.split(/[^A-Za-z0-9_]+/).includes(key)),
      )
      const name =
        resolved.kind === 'resolved' ? resolved.target.name : evidenced.length === 1 ? evidenced[0].name : need.name
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
      ...(c.providerControls ? { providerControls: c.providerControls.map(p => {
        const resolved = resolveGuardPrerequisiteNormalized(p.service, guardProviderTargets(targets))
        return resolved.kind === 'resolved' && resolved.target.name !== p.service
          ? { ...p, service: resolved.target.name, originalNames: [...new Set([...(p.originalNames ?? []), p.service])] } : p
      }) } : {}),
      prerequisites: (c.prerequisites ?? []).map((p) => {
        const resolved = resolveGuardPrerequisiteNormalized(p.dependency, targets)
        const evidenced = targets.filter((t) =>
          t.credentialEnv.some((key) => p.evidence?.split(/[^A-Za-z0-9_]+/).includes(key)),
        )
        const declared = requirements.find((r) => r.originalNames.includes(p.dependency))
        const name =
          resolved.kind === 'resolved' ? resolved.target.name : evidenced.length === 1 ? evidenced[0].name : declared?.dependency ?? p.dependency
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
  recipe?: Recipe,
) {
  const problems = scenarioPrerequisiteProblems(scenarioCasePrerequisites(flow, scenario), targets, scenario, preparationEnv)
  for (const proof of scenarioMilestoneProof(scenario.steps)) {
    const verification = flow.milestones.find(m => m.order === proof.milestone)?.verification
    const capability = verificationCapabilityGap(verification, proof.driver, proof.checks)
    if (capability) problems.push({ dependency: 'verification', reason: capability })
    if (!recipe) continue
    const controls = verification?.cases
      ?.filter(c => !proof.checks || proof.checks.includes(c.id)).flatMap(c => c.providerControls ?? []) ?? []
    problems.push(...scenarioProviderControlProblems(controls, proof.driver, targets, recipe, scenario).map(reason => ({ dependency: 'provider-control', reason })))
  }
  return problems
}

/** Shared runtime/estimate partition: eligibility changes the matcher input and key. */
export function partitionFlowPrerequisites(
  flow: GuardFlow,
  surface: GuardDriverId,
  targets: readonly GuardPrerequisiteTarget[],
  recipe: Recipe,
): { flow: GuardFlow; gaps: GuardManifestGap[] } {
  const gaps: GuardManifestGap[] = []
  // API commands are checked after matching binds the actual server.
  const invocationGaps = surface === 'web' ? flowInvocationGaps(flow, surface, recipe) : []
  const milestones = flow.milestones.flatMap((m) => {
    if (!m.verification?.cases) return [m]
    const cases = m.verification.cases.filter((c) => {
      const capabilityReason = verificationCapabilityGap(m.verification, surface, [c.id])
      if (capabilityReason) {
        const supported = GUARD_OBSERVATION_CAPABILITIES[surface] ?? []
        gaps.push({
          surface,
          kind: 'blocked-on',
          milestones: [m.order],
          obligations: [{ milestone: m.order, caseId: c.id }],
          reason: capabilityReason,
          blocker: {
            kind: 'unsupported-capability',
            capabilities: verificationRequirements(m.verification, [c.id]).filter((r) => !supported.includes(r)),
          },
        })
      }
      const controlProblems = (c.providerControls ?? []).flatMap(control => {
        const resolved = resolveProviderControl(control, surface, targets, recipe)
        return 'problem' in resolved ? [resolved.problem] : []
      })
      if (c.requires.includes('provider-control') && !c.providerControls?.length) controlProblems.push('provider-control requires a named providerControls declaration.')
      if (controlProblems.length) {
        gaps.push({ surface, kind: 'blocked-on', milestones: [m.order], obligations: [{ milestone: m.order, caseId: c.id }],
          reason: controlProblems.join(' '), blocker: { kind: 'generation', action: 'Declare the provider and its controllable base URL variables, then regenerate.' } })
        return false
      }
      const unresolved = (c.prerequisites ?? [])
        .map((p) => ({ prerequisite: p, resolution: resolveGuardPrerequisite(p.dependency, targets) }))
        .filter((r) => r.resolution.kind !== 'resolved')
      if (unresolved.length) {
        gaps.push({
          surface,
          kind: 'blocked-on',
          milestones: [m.order],
          obligations: [{ milestone: m.order, caseId: c.id }],
          reason: unresolved
            .map(
              ({ prerequisite, resolution }) =>
                `Prerequisite ${prerequisite.dependency} (${prerequisite.mode}) matches ${resolution.kind === 'ambiguous' ? 'more than one declared dependency' : 'no declared dependency'}.`,
            )
            .join(' '),
          blocker: {
            kind: 'generation',
            action: 'Resolve the extracted prerequisite to a declared service or dependency before generating this case.',
          },
        })
        return false
      }
      const invocationGap = invocationGaps.find(gap => gap.obligations?.some(o => o.milestone === m.order && o.caseId === c.id))
      if (invocationGap) { gaps.push(invocationGap); return false }
      const problems = prerequisiteProblems(
        (c.prerequisites ?? []).filter((p) => p.mode === 'provided'),
        targets,
      )
      if (!problems.length) return !capabilityReason
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

/** Validate the command the selected server will execute, including default binding. */
export function flowInvocationGaps(
  flow: GuardFlow,
  surface: GuardDriverId,
  recipe: Recipe,
  server?: string,
): GuardManifestGap[] {
  if (surface !== 'api' && surface !== 'web') return []
  const servers = resolveApiServers(recipe)
  const serve = surface === 'web' ? resolveWebSurface(recipe)?.serve ?? []
    : servers.servers.get(server ?? servers.defaultServer)?.serve ?? []
  return flow.milestones.flatMap(m => m.verification?.cases?.flatMap(c => {
    const reason = c.invocation && invocationProofGap(c.invocation, serve)
    return reason ? [{
      surface, kind: 'blocked-on' as const, milestones: [m.order],
      obligations: [{ milestone: m.order, caseId: c.id }], reason,
      blocker: { kind: 'generation' as const, action: 'Map an executor invocation that proves the documented command and address.' },
    }] : []
  }) ?? [])
}

/** Account availability affects work selection; secret rotation never affects its hash. */
export function flowPrerequisiteStateMaterial(flow: GuardFlow, targets: readonly GuardPrerequisiteTarget[], recipe?: Recipe): string {
  const controls = flow.milestones.flatMap(m => m.verification?.cases?.flatMap(c => c.providerControls ?? []) ?? [])
  const accounts = flow.milestones.flatMap(
      (m) =>
        m.verification?.cases?.flatMap((c) =>
          (c.prerequisites ?? [])
            .filter((p) => p.mode === 'provided')
            .map((p) => {
              const resolved = resolveGuardPrerequisite(p.dependency, targets)
              return [p.dependency, resolved.kind === 'resolved' ? resolved.target.state : 'unknown']
            }),
        ) ?? [],
    )
  return JSON.stringify(recipe && controls.length ? [providerControlStateMaterial(controls, 'api', targets, recipe), accounts] : accounts)
}
