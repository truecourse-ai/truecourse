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
 * Check if an import matches any pattern (supports wildcards like @aws-sdk/*).
 * Case-insensitive: C# namespaces are PascalCase (StackExchange.Redis) while
 * patterns are written lowercase; npm/PyPI names are lowercase already.
 */
export function matchesPattern(importPath: string, pattern: string): boolean {
  const importLower = importPath.toLowerCase()
  const patternLower = pattern.toLowerCase()

  if (patternLower.endsWith('/*')) {
    // Wildcard pattern like @aws-sdk/*
    const prefix = patternLower.slice(0, -2)
    return importLower.startsWith(prefix)
  } else if (patternLower.includes('*')) {
    // Generic glob pattern (convert to regex)
    const regex = new RegExp('^' + patternLower.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$')
    return regex.test(importLower)
  } else {
    // Exact match
    return importLower === patternLower
  }
}
