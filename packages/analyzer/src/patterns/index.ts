export { serviceDetectionPatterns } from './service-patterns.js'
export {
  dataLayerPatterns,
  apiLayerPatterns,
  externalLayerPatterns,
} from './layer-patterns.js'

/**
 * Check if an import matches any pattern (supports wildcards like @aws-sdk/*)
 */
export function matchesPattern(importPath: string, pattern: string): boolean {
  if (pattern.endsWith('/*')) {
    // Wildcard pattern like @aws-sdk/*
    const prefix = pattern.slice(0, -2)
    return importPath.startsWith(prefix)
  } else if (pattern.includes('*')) {
    // Generic glob pattern (convert to regex)
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
    return regex.test(importPath)
  } else {
    // Exact match
    return importPath === pattern
  }
}
