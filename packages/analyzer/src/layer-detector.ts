import type { FileAnalysis, Layer, LayerDetectionResult } from '@truecourse/shared'
import { dataLayerPatterns, apiLayerPatterns, externalLayerPatterns } from './patterns/layer-patterns.js'
import { matchesPattern } from './patterns/index.js'
import { minimatch } from 'minimatch'

/** Framework imports that are utilities, not route-defining symbols.
 *  Files importing only these from a framework (e.g., fastapi) are not API layer. */
const FRAMEWORK_UTILITY_IMPORTS = new Set([
  'HTTPException', 'Depends', 'Header', 'Body', 'Query', 'Path', 'Form', 'File',
  'UploadFile', 'status', 'Response', 'JSONResponse', 'BackgroundTasks', 'Security',
  'Cookie', 'Request', 'WebSocket',
])

/**
 * Internal layer detection result with multiple layers
 * (The shared type LayerDetectionResult is per-layer; this is for internal use)
 */
export interface InternalLayerDetection {
  layers: Layer[]
  confidence: number
  reasons: string[]
}

/**
 * Detect which architectural layers a file belongs to
 * A file can belong to multiple layers (e.g., API controller that also makes external calls)
 */
export function detectLayers(analysis: FileAnalysis): InternalLayerDetection {
  const layers: Layer[] = []
  const reasons: string[] = []

  // Check data layer
  const dataResult = hasDataLayerPatterns(analysis)
  if (dataResult.match) {
    layers.push('data')
    reasons.push(...dataResult.reasons)
  }

  // Check API layer
  const apiResult = hasAPILayerPatterns(analysis)
  if (apiResult.match) {
    layers.push('api')
    reasons.push(...apiResult.reasons)
  }

  // Check external layer
  const externalResult = hasExternalLayerPatterns(analysis)
  if (externalResult.match) {
    layers.push('external')
    reasons.push(...externalResult.reasons)
  }

  // Default to service layer if no other layers detected
  if (layers.length === 0) {
    layers.push('service')
    reasons.push('Business logic or utility file (default layer)')
  }

  const confidence = calculateConfidence(layers, reasons)

  return {
    layers,
    confidence,
    reasons,
  }
}

/**
 * Convert internal detection to shared LayerDetectionResult array
 */
export function toLayerDetectionResults(detection: InternalLayerDetection): LayerDetectionResult[] {
  return detection.layers.map(layer => ({
    layer,
    confidence: detection.confidence,
    evidence: detection.reasons,
  }))
}

/**
 * Check if file matches data layer patterns
 */
function hasDataLayerPatterns(
  analysis: FileAnalysis,
): { match: boolean; reasons: string[] } {
  const reasons: string[] = []

  // Check ORM imports
  for (const imp of analysis.imports) {
    if (dataLayerPatterns.orms.some(orm => matchesPattern(imp.source, orm))) {
      reasons.push(`Imports ORM: ${imp.source}`)
      return { match: true, reasons }
    }
  }

  // Check database driver imports
  const allDrivers: string[] = []
  for (const db of Object.values(dataLayerPatterns.drivers)) {
    allDrivers.push(...db)
  }

  for (const imp of analysis.imports) {
    if (allDrivers.some(driver => matchesPattern(imp.source, driver))) {
      reasons.push(`Imports database driver: ${imp.source}`)
      return { match: true, reasons }
    }
  }

  // Check query builders
  for (const imp of analysis.imports) {
    if (dataLayerPatterns.queryBuilders.some(qb => matchesPattern(imp.source, qb))) {
      reasons.push(`Imports query builder: ${imp.source}`)
      return { match: true, reasons }
    }
  }

  // Check file patterns
  for (const pattern of dataLayerPatterns.filePatterns) {
    if (minimatch(analysis.filePath, pattern)) {
      reasons.push(`File path matches data layer pattern: ${pattern}`)
      return { match: true, reasons }
    }
  }

  return { match: false, reasons }
}

/**
 * Check if file matches API layer patterns
 */
function hasAPILayerPatterns(
  analysis: FileAnalysis,
): { match: boolean; reasons: string[] } {
  const reasons: string[] = []

  // Check framework imports — for Python frameworks (fastapi, flask, django),
  // only count as API layer if the import includes route-defining symbols
  // (FastAPI, APIRouter, Blueprint, etc.), not just utilities (HTTPException, Depends).
  for (const imp of analysis.imports) {
    if (apiLayerPatterns.frameworks.some(fw => matchesPattern(imp.source, fw))) {
      // If all imported names are utility-only, don't classify as API layer
      const importedNames = imp.specifiers.map(s => s.name)
      if (importedNames.length > 0 && importedNames.every(n => FRAMEWORK_UTILITY_IMPORTS.has(n))) {
        continue
      }
      reasons.push(`Imports API framework: ${imp.source}`)
      return { match: true, reasons }
    }
  }

  // Check GraphQL imports
  for (const imp of analysis.imports) {
    if (apiLayerPatterns.graphql.some(gql => matchesPattern(imp.source, gql))) {
      reasons.push(`Imports GraphQL library: ${imp.source}`)
      return { match: true, reasons }
    }
  }

  // Check RPC patterns
  for (const imp of analysis.imports) {
    if (apiLayerPatterns.rpcPatterns.some(rpc => matchesPattern(imp.source, rpc))) {
      reasons.push(`Imports RPC library: ${imp.source}`)
      return { match: true, reasons }
    }
  }

  // Check file patterns — but for broad directory patterns like **/api/**,
  // only match if the file also has route registrations, to avoid classifying
  // utility/model files in api/ directories as API layer.
  const broadDirPatterns = new Set(['**/api/**', '**/views/**'])
  const hasRoutes = (analysis.routeRegistrations?.length ?? 0) > 0

  for (const pattern of apiLayerPatterns.filePatterns) {
    if (minimatch(analysis.filePath, pattern)) {
      // Broad patterns require evidence of actual route handling
      if (broadDirPatterns.has(pattern) && !hasRoutes) continue
      reasons.push(`File path matches API layer pattern: ${pattern}`)
      return { match: true, reasons }
    }
  }

  return { match: false, reasons }
}

/**
 * Check if file matches external layer patterns
 */
function hasExternalLayerPatterns(
  analysis: FileAnalysis,
): { match: boolean; reasons: string[] } {
  const reasons: string[] = []

  // Check HTTP client imports
  for (const imp of analysis.imports) {
    if (externalLayerPatterns.httpClients.some(client => matchesPattern(imp.source, client))) {
      reasons.push(`Imports HTTP client: ${imp.source}`)
      return { match: true, reasons }
    }
  }

  // Check external service SDKs
  const serviceCategories = [
    externalLayerPatterns.cloudServices,
    externalLayerPatterns.paymentServices,
    externalLayerPatterns.messagingServices,
    externalLayerPatterns.aiServices,
    externalLayerPatterns.authServices,
  ]

  for (const category of serviceCategories) {
    for (const [serviceName, servicePackages] of Object.entries(category)) {
      for (const imp of analysis.imports) {
        if (servicePackages.some(pkg => matchesPattern(imp.source, pkg))) {
          reasons.push(`Imports external service SDK (${serviceName}): ${imp.source}`)
          return { match: true, reasons }
        }
      }
    }
  }

  // Check message queue imports
  for (const [queueName, queueConfig] of Object.entries(externalLayerPatterns.messageQueues)) {
    for (const imp of analysis.imports) {
      if (queueConfig.packages.some(pkg => matchesPattern(imp.source, pkg))) {
        reasons.push(`Imports message queue (${queueName}): ${imp.source}`)
        return { match: true, reasons }
      }
    }
  }

  // Check file patterns
  for (const pattern of externalLayerPatterns.filePatterns) {
    if (minimatch(analysis.filePath, pattern)) {
      reasons.push(`File path matches external layer pattern: ${pattern}`)
      return { match: true, reasons }
    }
  }

  return { match: false, reasons }
}

/**
 * Calculate confidence score based on detection results
 */
function calculateConfidence(layers: Layer[], reasons: string[]): number {
  // High confidence if we detected specific patterns
  if (reasons.length > 0 && layers.length > 0 && !layers.includes('service')) {
    return 0.9
  }

  // Medium confidence for service layer (default)
  if (layers.includes('service') && layers.length === 1) {
    return 0.5
  }

  // Very high confidence for multiple layer detections
  if (layers.length > 1) {
    return 0.95
  }

  return 0.7
}
