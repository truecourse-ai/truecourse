import type { FileAnalysis, ModuleDependency } from '@truecourse/shared'
import { discoverFiles as _discoverFiles } from './file-discovery.js'
import { analyzeFile as _analyzeFile } from './file-analyzer.js'
import { buildDependencyGraph as _buildDependencyGraph } from './dependency-graph.js'
import { performSplitAnalysis as _performSplitAnalysis, type SplitAnalysisResult } from './split-analyzer.js'

// Core analysis functions
export { analyzeFile, analyzeFileContent } from './file-analyzer.js'
export { buildDependencyGraph, findEntryPoints } from './dependency-graph.js'
export { detectServices, type Service } from './service-detector.js'
export { detectLayers, toLayerDetectionResults, type InternalLayerDetection } from './layer-detector.js'
export { discoverFiles } from './file-discovery.js'
export { performSplitAnalysis, type SplitAnalysisResult } from './split-analyzer.js'

// Parser utilities
export { parseCode, parseFile, getParser } from './parser.js'

// Language configuration
export { detectLanguage, getLanguageConfig, type LanguageConfig } from './language-config.js'
export { TYPESCRIPT_CONFIG, JAVASCRIPT_CONFIG } from './language-config.js'

// Extractors
export { extractCalls, buildFunctionContext } from './extractors/calls.js'
export { extractHttpCalls } from './extractors/http-calls.js'
export { shouldExtractEntities, extractEntities } from './extractors/entities.js'
export {
  extractTypeScriptFunctions,
  extractTypeScriptClasses,
  extractTypeScriptImports,
  extractTypeScriptExports,
} from './extractors/languages/typescript.js'
export {
  extractJavaScriptFunctions,
  extractJavaScriptClasses,
  extractJavaScriptImports,
  extractJavaScriptExports,
} from './extractors/languages/javascript.js'
export { createSourceLocation, extractDocComment } from './extractors/languages/common.js'

// Patterns
export { matchesPattern, serviceDetectionPatterns, dataLayerPatterns, apiLayerPatterns, externalLayerPatterns } from './patterns/index.js'

/**
 * High-level function to analyze an entire repository
 * Orchestrates file discovery, analysis, dependency graph, service detection, and layer detection
 */
export async function analyzeRepository(rootPath: string): Promise<{
  analyses: FileAnalysis[]
  dependencies: ModuleDependency[]
  splitResult: SplitAnalysisResult
}> {
  // 1. Discover all source files
  const files = _discoverFiles(rootPath)

  if (files.length === 0) {
    return {
      analyses: [],
      dependencies: [],
      splitResult: {
        services: [],
        dependencies: [],
        architecture: 'monolith',
        layerDetails: [],
        layerDependencies: [],
      },
    }
  }

  // 2. Analyze each file
  const analyses: FileAnalysis[] = []
  for (const file of files) {
    try {
      const analysis = await _analyzeFile(file)
      if (analysis) {
        analyses.push(analysis)
      }
    } catch (error) {
      // Skip files that fail to analyze
    }
  }

  // 3. Build dependency graph (pass rootPath for workspace package resolution)
  const dependencies = _buildDependencyGraph(analyses, rootPath)

  // 4. Perform split analysis (service detection + layer detection)
  const splitResult = _performSplitAnalysis(rootPath, analyses, dependencies)

  return {
    analyses,
    dependencies,
    splitResult,
  }
}
