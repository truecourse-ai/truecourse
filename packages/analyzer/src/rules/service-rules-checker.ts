import type { ServiceInfo, ServiceDependencyInfo, AnalysisRule } from '@truecourse/shared'

export interface ServiceViolation {
  ruleKey: string
  title: string
  description: string
  severity: string
  serviceName: string
  /** For dependency violations: the service on the other end of the edge */
  relatedServiceName?: string
}

const GOD_SERVICE_FILE_THRESHOLD = 20
const GOD_SERVICE_LAYER_THRESHOLD = 4

/**
 * Check deterministic service-level rules and return violations.
 */
export function checkServiceRules(
  services: ServiceInfo[],
  dependencies: ServiceDependencyInfo[],
  enabledRules: AnalysisRule[],
): ServiceViolation[] {
  const violations: ServiceViolation[] = []
  const ruleKeys = new Set(enabledRules.filter(r => r.type === 'deterministic' && r.enabled).map(r => r.key))

  // Circular service dependency
  if (ruleKeys.has('arch/circular-service-dependency')) {
    const depSet = new Map<string, Set<string>>()
    for (const dep of dependencies) {
      if (!depSet.has(dep.source)) depSet.set(dep.source, new Set())
      depSet.get(dep.source)!.add(dep.target)
    }

    const reported = new Set<string>()
    for (const [source, targets] of depSet) {
      for (const target of targets) {
        if (depSet.get(target)?.has(source) && !reported.has(`${target}::${source}`)) {
          reported.add(`${source}::${target}`)
          violations.push({
            ruleKey: 'arch/circular-service-dependency',
            title: `Circular dependency: ${source} ↔ ${target}`,
            description: `${source} and ${target} depend on each other, creating a circular dependency. Consider extracting shared logic into a separate service or reversing one direction.`,
            severity: 'high',
            serviceName: source,
            relatedServiceName: target,
          })
        }
      }
    }
  }

  // God service
  if (ruleKeys.has('arch/god-service')) {
    for (const svc of services) {
      const layerCount = svc.layers?.length || 0
      if (svc.fileCount > GOD_SERVICE_FILE_THRESHOLD || layerCount >= GOD_SERVICE_LAYER_THRESHOLD) {
        const reasons: string[] = []
        if (svc.fileCount > GOD_SERVICE_FILE_THRESHOLD) {
          reasons.push(`${svc.fileCount} files (threshold: ${GOD_SERVICE_FILE_THRESHOLD})`)
        }
        if (layerCount >= GOD_SERVICE_LAYER_THRESHOLD) {
          reasons.push(`${layerCount} layers (threshold: ${GOD_SERVICE_LAYER_THRESHOLD})`)
        }
        violations.push({
          ruleKey: 'arch/god-service',
          title: `God service: ${svc.name}`,
          description: `${svc.name} has ${reasons.join(' and ')}, suggesting too many responsibilities. Consider splitting into smaller, focused services.`,
          severity: 'medium',
          serviceName: svc.name,
        })
      }
    }
  }

  return violations
}
