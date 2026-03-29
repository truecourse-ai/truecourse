import type { SupportedLanguage } from '@truecourse/shared'

/**
 * Language-specific configuration for tree-sitter parsing
 */
export interface LanguageConfig {
  name: SupportedLanguage
  fileExtensions: string[]

  // Module resolution configuration
  moduleResolution: {
    // Extensions to try when resolving imports (in order of priority)
    extensions: string[]
    // Index file names to try for directory imports
    indexFiles: string[]
  }

  // AST node types for different language constructs
  functionNodeTypes: string[]
  classNodeTypes: string[]
  importNodeTypes: string[]
  exportNodeTypes: string[]
  callNodeTypes: string[]

  // URL interpolation patterns — how this language embeds variables in URL strings.
  // Used to normalize raw URLs from source code into language-agnostic route patterns.
  // See ADDING_A_LANGUAGE.md for details.
  urlInterpolation: {
    // Regex matching a base-URL variable (e.g., `${BASE_URL}` in JS, `{baseUrl}` in C#)
    baseUrlVar: RegExp
    // Regex matching any interpolated variable (e.g., `${id}` in JS, `{id}` in C#)
    paramVar: RegExp
    // Characters to strip from raw URL strings (e.g., backticks for JS template literals)
    stripChars?: RegExp
  }

  // Package/project indicator files
  packageIndicatorFiles: string[]

  // Ignore patterns for file discovery
  ignorePatterns: string[]

  // Test file patterns (excluded from analysis)
  testPatterns: string[]

  // Bootstrap entry point patterns
  bootstrap: {
    filePattern: RegExp
    functionNames: string[]
  }

  // Rule thresholds — language-specific overrides
  thresholds: {
    maxParameters: number
  }

  // Optional: Custom tree-sitter query strings
  functionQuery?: string
  classQuery?: string
  importQuery?: string
  exportQuery?: string
}

/**
 * TypeScript language configuration
 */
export const TYPESCRIPT_CONFIG: LanguageConfig = {
  name: 'typescript',
  fileExtensions: ['.ts'],

  moduleResolution: {
    extensions: ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx'],
    indexFiles: ['index.ts', 'index.tsx', 'index.mts', 'index.cts', 'index.js', 'index.jsx'],
  },

  functionNodeTypes: [
    'function_declaration',
    'arrow_function',
    'function_expression',
    'method_definition',
    'function_signature', // For ambient declarations
  ],

  classNodeTypes: [
    'class_declaration',
    'abstract_class_declaration',
  ],

  importNodeTypes: ['import_statement', 'import_clause'],

  exportNodeTypes: ['export_statement'],

  callNodeTypes: ['call_expression'],

  urlInterpolation: {
    baseUrlVar: /\$\{[^}]*URL[^}]*\}/gi,
    paramVar: /\$\{[^}]+\}/g,
    stripChars: /`/g,
  },

  // Simplified queries - just capture node types
  functionQuery: `
    (function_declaration) @function
    (method_definition) @function
    (arrow_function) @function
  `,

  classQuery: `
    (class_declaration) @class
    (abstract_class_declaration) @class
  `,

  importQuery: `
    (import_statement) @import
  `,

  packageIndicatorFiles: ['package.json'],
  ignorePatterns: [],
  testPatterns: ['**/*.test.*', '**/*.spec.*', '**/__tests__/', '**/__mocks__/'],
  bootstrap: {
    filePattern: /(?:^|[/\\])(?:app|main|index|server)\.\w+$/,
    functionNames: ['start', 'main', 'bootstrap'],
  },
  thresholds: {
    maxParameters: 5,
  },

  exportQuery: `
    (export_statement) @export
  `,
}

/**
 * JavaScript language configuration
 * TSX — TypeScript with JSX. Extends TypeScript config, only differs in file extension
 * and uses the TSX tree-sitter grammar which recognizes JSX syntax nodes.
 */
export const TSX_CONFIG: LanguageConfig = {
  ...TYPESCRIPT_CONFIG,
  name: 'tsx',
  fileExtensions: ['.tsx'],
}

/**
 * Reuses TypeScript queries (they work for JS too)
 */
export const JAVASCRIPT_CONFIG: LanguageConfig = {
  ...TYPESCRIPT_CONFIG,
  name: 'javascript',
  fileExtensions: ['.js', '.jsx'],

  moduleResolution: {
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    indexFiles: ['index.js', 'index.jsx', 'index.mjs', 'index.cjs'],
  },

  functionNodeTypes: [
    'function_declaration',
    'arrow_function',
    'function_expression',
    'method_definition',
    'generator_function_declaration',
  ],

  classNodeTypes: ['class_declaration', 'class'],

  // Simplified queries for JavaScript
  functionQuery: `
    (function_declaration) @function
    (method_definition) @function
    (arrow_function) @function
    (function_expression) @function
    (generator_function_declaration) @function
    (generator_function) @function
  `,

  classQuery: `
    (class_declaration) @class
    (class) @class
  `,
}

/**
 * Python language configuration
 */
export const PYTHON_CONFIG: LanguageConfig = {
  name: 'python',
  fileExtensions: ['.py'],

  moduleResolution: {
    extensions: ['.py'],
    indexFiles: ['__init__.py'],
  },

  functionNodeTypes: ['function_definition'],
  classNodeTypes: ['class_definition'],
  importNodeTypes: ['import_statement', 'import_from_statement'],
  exportNodeTypes: [], // Python has no explicit export syntax
  callNodeTypes: ['call'],

  urlInterpolation: {
    // Python f-strings: f"{BASE_URL}/users/{id}"
    baseUrlVar: /\{[^}]*[Uu]rl[^}]*\}/gi,
    paramVar: /\{[^}]+\}/g,
  },

  functionQuery: `(function_definition) @function`,

  classQuery: `(class_definition) @class`,

  packageIndicatorFiles: ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', '__init__.py'],
  ignorePatterns: ['**/__pycache__/', '**/.venv/', '**/venv/', '**/.pytest_cache/', '**/*.egg-info/'],
  testPatterns: ['**/test_*.py', '**/*_test.py', '**/conftest.py'],
  bootstrap: {
    filePattern: /(?:^|[/\\])(?:app|main|wsgi|asgi)\.\w+$/,
    functionNames: ['start', 'main', '__main__', 'bootstrap'],
  },
  thresholds: {
    maxParameters: 7, // Python uses keyword args extensively
  },

  importQuery: `
    (import_statement) @import
    (import_from_statement) @import
  `,
}

/**
 * Registry of all language configurations. Add new languages here.
 */
const LANGUAGE_CONFIGS: LanguageConfig[] = [TYPESCRIPT_CONFIG, TSX_CONFIG, JAVASCRIPT_CONFIG, PYTHON_CONFIG]

// ---------------------------------------------------------------------------
// Helpers — aggregate across all languages
// ---------------------------------------------------------------------------

export function getAllFileExtensions(): string[] {
  return LANGUAGE_CONFIGS.flatMap((c) => c.fileExtensions)
}

export function getAllIgnorePatterns(): string[] {
  return LANGUAGE_CONFIGS.flatMap((c) => c.ignorePatterns)
}

export function getAllTestPatterns(): string[] {
  return LANGUAGE_CONFIGS.flatMap((c) => c.testPatterns)
}

export function getAllPackageIndicatorFiles(): string[] {
  return [...new Set(LANGUAGE_CONFIGS.flatMap((c) => c.packageIndicatorFiles))]
}

export function getAllIndexBaseNames(): Set<string> {
  const names = new Set<string>()
  for (const config of LANGUAGE_CONFIGS) {
    for (const indexFile of config.moduleResolution.indexFiles) {
      const dot = indexFile.lastIndexOf('.')
      names.add(dot >= 0 ? indexFile.slice(0, dot) : indexFile)
    }
  }
  return names
}

export function getMaxParameters(filePath: string): number {
  const lang = detectLanguage(filePath)
  if (lang) {
    const config = LANGUAGE_CONFIGS.find((c) => c.name === lang)
    if (config) return config.thresholds.maxParameters
  }
  return 5 // default
}

export function isBootstrapEntry(functionName: string, filePath: string): boolean {
  return LANGUAGE_CONFIGS.some(
    (c) => c.bootstrap.functionNames.includes(functionName) && c.bootstrap.filePattern.test(filePath)
  )
}

/**
 * Get language configuration by language name
 */
export function getLanguageConfig(language: SupportedLanguage): LanguageConfig {
  const config = LANGUAGE_CONFIGS.find((c) => c.name === language)
  if (!config) throw new Error(`Unsupported language: ${language}`)
  return config
}

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = filePath.substring(filePath.lastIndexOf('.'))
  const config = LANGUAGE_CONFIGS.find((c) => c.fileExtensions.includes(ext))
  return config?.name ?? null
}

/**
 * Normalize a raw URL string from source code into a language-agnostic route pattern.
 * Uses the language's urlInterpolation config to handle language-specific syntax.
 *
 * Example (TypeScript): `${USER_SERVICE_URL}/users/${id}` → `/users/:param`
 *
 * The result uses `:param` for path parameters and has no language-specific syntax.
 */
export function normalizeUrl(url: string, language: SupportedLanguage): string {
  const config = getLanguageConfig(language)
  const { baseUrlVar, paramVar, stripChars } = config.urlInterpolation

  let normalized = url
  if (stripChars) normalized = normalized.replace(stripChars, '')
  normalized = normalized
    .replace(baseUrlVar, '')               // remove base URL vars
    .replace(paramVar, ':param')           // remaining vars → :param
    .replace(/https?:\/\/[^/]*/g, '')      // remove protocol+host
    .replace(/\/+/g, '/')                  // collapse slashes
    .replace(/\/$/, '')                    // remove trailing slash

  return normalized || '/'
}
