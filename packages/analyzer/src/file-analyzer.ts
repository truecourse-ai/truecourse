import { readFile } from 'fs/promises'
import type { FileAnalysis, SupportedLanguage, ExportStatement } from '@truecourse/shared'
import { detectLanguage } from './language-config.js'
import { parseFile } from './parser.js'
import { extractCalls, buildFunctionContext, extractIdentifierReferences } from './extractors/calls.js'
import { extractHttpCalls } from './extractors/http-calls.js'
import { extractRouteRegistrations } from './extractors/route-registrations.js'
import {
  extractTypeScriptFunctions,
  extractTypeScriptClasses,
  extractTypeScriptImports,
  extractTypeScriptExports,
} from './extractors/languages/typescript.js'
import {
  extractJavaScriptFunctions,
  extractJavaScriptClasses,
  extractJavaScriptImports,
  extractJavaScriptExports,
} from './extractors/languages/javascript.js'
import {
  extractPythonFunctions,
  extractPythonClasses,
  extractPythonImports,
  extractPythonExports,
} from './extractors/languages/python.js'

/**
 * Analyze a single file and extract all code elements
 */
export async function analyzeFile(filePath: string): Promise<FileAnalysis | null> {
  // Detect language from file extension
  const language = detectLanguage(filePath)
  if (!language) {
    return null
  }

  try {
    // Read file content
    const content = await readFile(filePath, 'utf-8')

    // Parse the file. The Tree is a web-tree-sitter (WASM) handle whose
    // backing memory does NOT get freed by JS GC — it must be released
    // explicitly via tree.delete(). Without the try/finally below, every
    // file analyzed leaks one tree's worth of WASM memory; on a 1700-file
    // monorepo that's enough to OOM the process during the rule pass.
    const tree = parseFile(filePath, content, language)

    try {
      // Extract all elements using language-specific extractors
      let functions, classes, imports, exports: ExportStatement[]

      switch (language) {
        case 'typescript':
        case 'tsx':
          functions = extractTypeScriptFunctions(tree, filePath, language)
          classes = extractTypeScriptClasses(tree, filePath, language)
          imports = extractTypeScriptImports(tree, filePath, language)
          exports = extractTypeScriptExports(tree, filePath, language)
          break
        case 'javascript':
          functions = extractJavaScriptFunctions(tree, filePath)
          classes = extractJavaScriptClasses(tree, filePath)
          imports = extractJavaScriptImports(tree, filePath)
          exports = extractJavaScriptExports(tree, filePath)
          break
        case 'python':
          functions = extractPythonFunctions(tree, filePath)
          classes = extractPythonClasses(tree, filePath)
          imports = extractPythonImports(tree, filePath)
          exports = extractPythonExports(tree, filePath)
          break
        default:
          throw new Error(`Unsupported language: ${language}`)
      }

      // Build function context and extract calls
      const functionContext = buildFunctionContext(functions, classes)
      const calls = extractCalls(tree, filePath, language, functionContext)
      const httpCalls = extractHttpCalls(tree, filePath, language, functions, classes)
      const { routes: routeRegistrations, mounts: routerMounts } = extractRouteRegistrations(tree, filePath, language)
      const referencedNames = extractIdentifierReferences(tree, language)

      return {
        filePath,
        language,
        functions,
        classes,
        imports,
        exports,
        calls,
        httpCalls,
        ...(routeRegistrations.length > 0 ? { routeRegistrations } : {}),
        ...(routerMounts.length > 0 ? { routerMounts } : {}),
        ...(referencedNames.length > 0 ? { referencedNames } : {}),
      }
    } finally {
      tree.delete()
    }
  } catch (error) {
    throw new Error(
      `Failed to analyze file ${filePath}: ${
        error instanceof Error ? error.message : String(error)
      }`
    )
  }
}

/**
 * Analyze file from in-memory content (useful for testing)
 */
export function analyzeFileContent(
  filePath: string,
  content: string,
  language: SupportedLanguage
): FileAnalysis {
  // Parse the content. See analyzeFile() above for why tree.delete() is
  // mandatory — same WASM-memory leak applies here.
  const tree = parseFile(filePath, content, language)

  try {
    // Extract all elements using language-specific extractors
    let functions, classes, imports, exports: ExportStatement[]

    switch (language) {
      case 'typescript':
      case 'tsx':
        functions = extractTypeScriptFunctions(tree, filePath, language)
        classes = extractTypeScriptClasses(tree, filePath, language)
        imports = extractTypeScriptImports(tree, filePath, language)
        exports = extractTypeScriptExports(tree, filePath, language)
        break
      case 'javascript':
        functions = extractJavaScriptFunctions(tree, filePath)
        classes = extractJavaScriptClasses(tree, filePath)
        imports = extractJavaScriptImports(tree, filePath)
        exports = extractJavaScriptExports(tree, filePath)
        break
      default:
        throw new Error(`Unsupported language: ${language}`)
    }

    // Build function context and extract calls
    const functionContext = buildFunctionContext(functions, classes)
    const calls = extractCalls(tree, filePath, language, functionContext)
    const httpCalls = extractHttpCalls(tree, filePath, language, functions, classes)
    const { routes: routeRegistrations, mounts: routerMounts } = extractRouteRegistrations(tree, filePath, language)
    const referencedNames = extractIdentifierReferences(tree, language)

    return {
      filePath,
      language,
      functions,
      classes,
      imports,
      exports,
      calls,
      httpCalls,
      ...(routeRegistrations.length > 0 ? { routeRegistrations } : {}),
      ...(routerMounts.length > 0 ? { routerMounts } : {}),
      ...(referencedNames.length > 0 ? { referencedNames } : {}),
    }
  } finally {
    tree.delete()
  }
}
