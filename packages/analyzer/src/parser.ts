import Parser, { Tree } from 'tree-sitter'
import TypeScriptParser from 'tree-sitter-typescript'
import JavaScriptParser from 'tree-sitter-javascript'
import type { SupportedLanguage } from '@truecourse/shared'

/**
 * Parser cache to reuse parser instances
 */
const parserCache = new Map<SupportedLanguage, Parser>()

/**
 * Get the tree-sitter language for a supported language
 */
function getTreeSitterLanguage(language: SupportedLanguage): any {
  switch (language) {
    case 'typescript':
      return TypeScriptParser.typescript
    case 'tsx':
      return TypeScriptParser.tsx
    case 'javascript':
      return JavaScriptParser
    default:
      throw new Error(`Unsupported language: ${language}`)
  }
}

/**
 * Create or get cached parser for a language
 */
export function getParser(language: SupportedLanguage): Parser {
  let parser = parserCache.get(language)

  if (!parser) {
    parser = new Parser()
    const tsLanguage = getTreeSitterLanguage(language)
    parser.setLanguage(tsLanguage)
    parserCache.set(language, parser)
  }

  return parser
}

/**
 * Parse source code and return AST
 */
export function parseCode(code: string, language: SupportedLanguage): Tree {
  const parser = getParser(language)
  const tree = parser.parse(code)

  if (!tree) {
    throw new Error(`Failed to parse ${language} code`)
  }

  return tree
}

/**
 * Parse file content
 */
export function parseFile(
  filePath: string,
  code: string,
  language: SupportedLanguage
): Tree {
  try {
    return parseCode(code, language)
  } catch (error) {
    throw new Error(
      `Failed to parse file ${filePath}: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}
