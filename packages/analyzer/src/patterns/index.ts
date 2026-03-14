export { serviceDetectionPatterns } from './service-patterns.js'
export {
  dataLayerPatterns,
  apiLayerPatterns,
  externalLayerPatterns,
} from './layer-patterns.js'
export {
  DATABASE_IMPORT_MAP,
  CONNECTION_ENV_VARS,
  DOCKER_IMAGE_MAP,
  SCHEMA_FILE_PATTERNS,
} from './database-patterns.js'

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
