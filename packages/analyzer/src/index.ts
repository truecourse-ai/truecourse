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
export { detectLanguage, getLanguageConfig, isFrameworkEntryFile, normalizeUrl, type LanguageConfig } from './language-config.js'
export { TYPESCRIPT_CONFIG, JAVASCRIPT_CONFIG } from './language-config.js'

// Extractors
export { extractCalls, buildFunctionContext } from './extractors/calls.js'
export { extractHttpCalls } from './extractors/http-calls.js'
export { extractRouteRegistrations } from './extractors/route-registrations.js'
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

// Database detection
export { detectDatabases, parseDockerCompose } from './database-detector.js'
export { parsePrismaSchema } from './schema-parsers/prisma.js'
export { parseDrizzleSchema } from './schema-parsers/drizzle.js'

// Patterns
export { matchesPattern, serviceDetectionPatterns, dataLayerPatterns, apiLayerPatterns, externalLayerPatterns, DATABASE_IMPORT_MAP, CONNECTION_ENV_VARS, DOCKER_IMAGE_MAP } from './patterns/index.js'

// Module extraction
export { extractModulesAndMethods, type ModuleExtractionResult } from './module-extractor.js'

// Flow tracing
export { traceFlows, type TracedFlow, type TracedFlowStep, type TraceFlowsInput, type CrossServiceCall, type RouteHandler } from './flow-tracer.js'

// Rules
export { DETERMINISTIC_RULES, LLM_ARCHITECTURE_RULES, LLM_DATABASE_RULES, LLM_MODULE_RULES, LLM_CODE_RULES, CODE_RULES } from './rules/index.js'
export { getAllDefaultRules } from './rule-engine.js'
export { checkModuleRules, type ModuleViolation } from './rules/module-rules-checker.js'
export { checkCodeRules } from './rules/code-rules-checker.js'

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
        databaseResult: { databases: [], connections: [] },
        modules: [],
        methods: [],
        moduleLevelDependencies: [],
        methodLevelDependencies: [],
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
