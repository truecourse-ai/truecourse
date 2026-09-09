import type { DetectedExternalService, GuardDependenciesFile, GuardDependencyEnvVar } from '@truecourse/shared'

/** Source-backed requirements only. Names and evidence, never credential values. */
export function detectedCredentialVars(detected: readonly DetectedExternalService[]): GuardDependencyEnvVar[] {
  const byName = new Map<string, GuardDependencyEnvVar>()
  for (const service of detected) {
    for (const credential of service.credentialEnvs ?? []) {
      byName.set(credential.envVar, {
        name: credential.envVar,
        description: `the credential the program sends to ${service.service}`,
        secret: true,
      })
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Add missing fields to existing supplied env registrations; preserve curated entries. */
export function extendCredentialRegistrations(catalog: GuardDependenciesFile, detected: readonly DetectedExternalService[]): GuardDependenciesFile {
  let changed = false
  const dependencies = catalog.dependencies.map(entry => {
    if (entry.class !== 'supplied' || entry.registration?.kind !== 'env') return entry
    const known = new Set(entry.registration.vars.map(v => v.name))
    const additions = detectedCredentialVars(detected.filter(s => entry.services?.includes(s.service)))
      .filter(v => !known.has(v.name))
    if (additions.length === 0) return entry
    changed = true
    return { ...entry, registration: { ...entry.registration, vars: [...entry.registration.vars, ...additions] } }
  })
  return changed ? { ...catalog, dependencies } : catalog
}
