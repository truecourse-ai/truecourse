import { readFileSync } from 'fs'
import type {
  FileAnalysis,
  ModuleDependency,
  Layer,
  Architecture,
  ServiceInfo,
  ServiceDependencyInfo,
  ServiceDependencyDetail,
  HttpCall,
  Entity,
} from '@truecourse/shared'
import { detectLayers, toLayerDetectionResults } from './layer-detector.js'
import { detectServices, type Service } from './service-detector.js'
import { shouldExtractEntities, extractEntities } from './extractors/entities.js'

/**
 * Result of the split analysis
 */
export interface SplitAnalysisResult {
  services: ServiceInfo[]
  dependencies: ServiceDependencyInfo[]
  architecture: Architecture
}

/**
 * Perform split analysis on a codebase
 * Detects services, layers, and cross-service dependencies
 * Returns structured data instead of writing files
 */
export function performSplitAnalysis(
  rootPath: string,
  analyses: FileAnalysis[],
  dependencies: ModuleDependency[],
): SplitAnalysisResult {
  // 1. Detect all services
  const allFiles = analyses.map(a => a.filePath)
  const detectedServices = detectServices(rootPath, allFiles)
  const isMultiService = detectedServices.length > 1
  const architecture: Architecture = isMultiService ? 'microservices' : 'monolith'

  // 2. Create file-to-layer mapping
  const fileLayerMap = new Map<string, Layer[]>()
  for (const analysis of analyses) {
    const detection = detectLayers(analysis)
    fileLayerMap.set(analysis.filePath, detection.layers)
  }

  // 3. Process each service into ServiceInfo
  const services: ServiceInfo[] = []

  for (const service of detectedServices) {
    const serviceAnalyses = analyses.filter(a => service.files.includes(a.filePath))

    // Build layer detection results for this service
    const layerResultsMap = new Map<Layer, { confidence: number; evidence: string[] }>()

    for (const analysis of serviceAnalyses) {
      const detection = detectLayers(analysis)
      for (const layer of detection.layers) {
        if (!layerResultsMap.has(layer)) {
          layerResultsMap.set(layer, { confidence: detection.confidence, evidence: [] })
        }
        const existing = layerResultsMap.get(layer)!
        // Keep highest confidence
        if (detection.confidence > existing.confidence) {
          existing.confidence = detection.confidence
        }
        // Merge unique evidence
        for (const reason of detection.reasons) {
          if (!existing.evidence.includes(reason)) {
            existing.evidence.push(reason)
          }
        }
      }
    }

    const layers = Array.from(layerResultsMap.entries()).map(([layer, data]) => ({
      layer,
      confidence: data.confidence,
      evidence: data.evidence,
    }))

    services.push({
      name: service.name,
      rootPath: service.rootPath,
      type: service.type,
      framework: service.framework,
      fileCount: serviceAnalyses.length,
      layers,
      files: service.files,
    })
  }

  // 4. Calculate cross-service dependencies
  const serviceDependencies: ServiceDependencyInfo[] = []

  if (isMultiService) {
    // Import/export dependencies across services
    const crossServiceDeps = dependencies.filter(dep => {
      const sourceService = detectedServices.find(s => s.files.includes(dep.source))
      const targetService = detectedServices.find(s => s.files.includes(dep.target))
      return sourceService && targetService && sourceService.name !== targetService.name
    })

    // Group by source-target service pairs
    const depPairs = new Map<string, { deps: ServiceDependencyDetail[]; httpCalls: HttpCall[] }>()

    for (const dep of crossServiceDeps) {
      const sourceService = detectedServices.find(s => s.files.includes(dep.source))!
      const targetService = detectedServices.find(s => s.files.includes(dep.target))!
      const key = `${sourceService.name}::${targetService.name}`

      if (!depPairs.has(key)) {
        depPairs.set(key, { deps: [], httpCalls: [] })
      }

      depPairs.get(key)!.deps.push({
        filePath: dep.source,
        importedFrom: dep.target,
        importedNames: dep.importedNames,
      })
    }

    // Extract HTTP-based cross-service dependencies
    for (const analysis of analyses) {
      const sourceService = detectedServices.find(s => s.files.includes(analysis.filePath))
      if (!sourceService || !analysis.httpCalls) continue

      for (const httpCall of analysis.httpCalls) {
        const targetService = matchUrlToService(httpCall.url, detectedServices)

        if (targetService && targetService.name !== sourceService.name) {
          const key = `${sourceService.name}::${targetService.name}`

          if (!depPairs.has(key)) {
            depPairs.set(key, { deps: [], httpCalls: [] })
          }

          depPairs.get(key)!.httpCalls.push(httpCall)
        }
      }
    }

    // Convert to ServiceDependencyInfo
    for (const [key, value] of depPairs.entries()) {
      const [source, target] = key.split('::')
      serviceDependencies.push({
        source: source!,
        target: target!,
        dependencies: value.deps,
        httpCalls: value.httpCalls.length > 0 ? value.httpCalls : undefined,
      })
    }
  }

  return {
    services,
    dependencies: serviceDependencies,
    architecture,
  }
}

/**
 * Match a URL pattern to a target service
 */
function matchUrlToService(
  url: string,
  services: Service[]
): Service | null {
  const urlLower = url.toLowerCase()

  // Normalize service name variants for matching:
  // "user-service" → ["user-service", "user_service", "userservice"]
  function getServiceNameVariants(name: string): string[] {
    const lower = name.toLowerCase()
    return [
      lower,
      lower.replace(/-/g, '_'),
      lower.replace(/-/g, ''),
    ]
  }

  // 1. Try direct service name matching in the URL text
  for (const service of services) {
    const variants = getServiceNameVariants(service.name)
    for (const variant of variants) {
      if (urlLower.includes(variant)) {
        return service
      }
    }
  }

  // 2. Check for service name references in template string variable names
  //    e.g., `${USER_SERVICE_URL}/users` → matches "user-service"
  const templateVarPattern = /\$\{([^}]+)\}/g
  let match
  while ((match = templateVarPattern.exec(urlLower)) !== null) {
    const varName = match[1]!.toLowerCase()
    for (const service of services) {
      const variants = getServiceNameVariants(service.name)
      for (const variant of variants) {
        if (varName.includes(variant)) {
          return service
        }
      }
    }
  }

  // 3. If no direct match, infer from URL pattern and service types
  if (urlLower.startsWith('/api/') || urlLower.includes('`/api/')) {
    const apiServers = services.filter(s => s.type === 'api-server')

    if (apiServers.length === 1) {
      return apiServers[0]!
    }

    const apiService = apiServers.find(s => s.name.toLowerCase().includes('api'))
    if (apiService) {
      return apiService
    }

    if (apiServers.length > 0) {
      return apiServers[0]!
    }
  }

  return null
}
