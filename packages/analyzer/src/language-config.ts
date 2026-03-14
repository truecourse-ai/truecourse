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
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
  ],

  importNodeTypes: ['import_statement', 'import_clause'],

  exportNodeTypes: ['export_statement'],

  callNodeTypes: ['call_expression'],

  // Simplified queries - just capture node types
  functionQuery: `
    (function_declaration) @function
    (method_definition) @function
    (arrow_function) @function
  `,

  classQuery: `
    (class_declaration) @class
    (abstract_class_declaration) @class
    (interface_declaration) @class
    (type_alias_declaration) @class
    (enum_declaration) @class
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
 * Get language configuration by language name
 */
export function getLanguageConfig(language: SupportedLanguage): LanguageConfig {
  switch (language) {
    case 'typescript':
      return TYPESCRIPT_CONFIG
    case 'javascript':
      return JAVASCRIPT_CONFIG
    default:
      throw new Error(`Unsupported language: ${language}`)
  }
}

/**
 * Detect language from file extension
 */
export function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = filePath.substring(filePath.lastIndexOf('.'))

  if (TYPESCRIPT_CONFIG.fileExtensions.includes(ext)) {
    return 'typescript'
  }

  if (JAVASCRIPT_CONFIG.fileExtensions.includes(ext)) {
    return 'javascript'
  }

  return null
}
