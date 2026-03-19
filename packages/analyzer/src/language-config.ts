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

  // Framework entry file patterns (files invoked by the framework, not by user code)
  frameworkEntryPatterns: RegExp[]

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
  fileExtensions: ['.ts', '.tsx'],

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

  frameworkEntryPatterns: [
    /\bpage\.tsx?$/,
    /\blayout\.tsx?$/,
    /\bloading\.tsx?$/,
    /\berror\.tsx?$/,
    /\bnot-found\.tsx?$/,
    /\broute\.tsx?$/,
    /\bmiddleware\.tsx?$/,
    /\bworker\.tsx?$/,
    /\binstrument\.tsx?$/,
  ],

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

  exportQuery: `
    (export_statement) @export
  `,
}

/**
 * JavaScript language configuration
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
 * Registry of all language configurations. Add new languages here.
 */
const LANGUAGE_CONFIGS: LanguageConfig[] = [TYPESCRIPT_CONFIG, JAVASCRIPT_CONFIG]

/**
 * Get language configuration by language name
 */
export function getLanguageConfig(language: SupportedLanguage): LanguageConfig {
  const config = LANGUAGE_CONFIGS.find((c) => c.name === language)
  if (!config) throw new Error(`Unsupported language: ${language}`)
  return config
}

/**
 * Check if a file is a framework entry file (invoked by the framework, not by user code).
 * Checks against all registered language configs.
 */
export function isFrameworkEntryFile(filePath: string): boolean {
  return LANGUAGE_CONFIGS.some((config) =>
    config.frameworkEntryPatterns.some((pattern) => pattern.test(filePath)),
  )
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
