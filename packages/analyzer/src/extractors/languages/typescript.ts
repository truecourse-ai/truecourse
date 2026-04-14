import type { Tree, SyntaxNode } from 'tree-sitter'
import Parser from 'tree-sitter'
import type {
  FunctionDefinition,
  ClassDefinition,
  ImportStatement,
  ExportStatement,
  Parameter,
  ClassProperty,
  ImportSpecifier,
  SupportedLanguage,
} from '@truecourse/shared'
import { getLanguageConfig } from '../../language-config.js'
import { getParser } from '../../parser.js'

/** TypeScript-family languages (typescript and tsx share extractors) */
type TSLanguage = 'typescript' | 'tsx'
import { createSourceLocation, extractDocComment, computeFunctionMetrics } from './common.js'

/**
 * Extract function name from node.
 * For arrow functions / function expressions, check parent context:
 *  - variable_declarator: `const foo = () => {}` → "foo"
 *  - pair (object literal): `{ foo: () => {} }` → "foo"
 *  - assignment_expression: `obj.foo = () => {}` → "foo"
 *  - argument in a method call: `router.get('/', () => {})` → "get_handler"
 */
const FUNCTION_NODE_TYPES = new Set([
  'function_declaration', 'function', 'arrow_function',
  'generator_function_declaration', 'generator_function',
  'method_definition',
])

/** Check if a node is nested inside another function (not top-level) */
function isNestedInFunction(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (FUNCTION_NODE_TYPES.has(current.type)) return true
    current = current.parent
  }
  return false
}

function extractFunctionName(node: SyntaxNode): string {
  const nameNode = node.childForFieldName('name')
  if (nameNode?.text) return nameNode.text

  // Check parent for naming context
  const parent = node.parent
  if (!parent) return 'anonymous'

  // Skip arrow functions nested inside other functions — they're implementation details
  if (isNestedInFunction(node)) return 'anonymous'

  // const foo = () => {} or const foo = function() {}
  if (parent.type === 'variable_declarator') {
    const varName = parent.childForFieldName('name')
    if (varName?.text) return varName.text
  }

  // { foo: () => {} }
  if (parent.type === 'pair') {
    const key = parent.childForFieldName('key')
    if (key?.text) return key.text
  }

  // obj.foo = () => {}
  if (parent.type === 'assignment_expression') {
    const left = parent.childForFieldName('left')
    if (left?.type === 'member_expression') {
      const prop = left.childForFieldName('property')
      if (prop?.text) return prop.text
    }
  }

  return 'anonymous'
}

/**
 * Extract return type from node
 */
function extractReturnType(node: SyntaxNode): string | undefined {
  const returnTypeNode = node.childForFieldName('return_type')
  if (!returnTypeNode) return undefined

  return returnTypeNode.text.replace(/^:\s*/, '')
}

/**
 * Check if function is exported.
 * Simple check — just looks for an export_statement as a direct parent.
 * For TS/TSX projects, the compiler's export map (analyzeSemantics) overwrites
 * this with the definitive answer. This is only used as a basic fallback
 * for JS-only projects without a tsconfig.
 */
function isExported(node: SyntaxNode): boolean {
  return node.parent?.type === 'export_statement'
}

/**
 * Check if function is async
 */
function isAsync(node: SyntaxNode): boolean {
  for (const child of node.children) {
    if (child.type === 'async' || child.text === 'async') {
      return true
    }
  }
  return false
}

/**
 * Extract parameters from TypeScript/JavaScript function
 */
function extractParameters(paramsNode: SyntaxNode | null): Parameter[] {
  if (!paramsNode) return []

  const parameters: Parameter[] = []

  for (const child of paramsNode.namedChildren) {
    if (child.type === 'required_parameter' || child.type === 'optional_parameter') {
      const pattern = child.childForFieldName('pattern')
      const typeAnnotation = child.childForFieldName('type')
      const value = child.childForFieldName('value')

      const name = pattern?.text || 'unknown'
      const type = typeAnnotation?.text?.replace(/^:\s*/, '')
      const defaultValue = value?.text

      parameters.push({
        name,
        type,
        defaultValue,
      })
    }
  }

  return parameters
}

/**
 * Extract class name from node
 */
function extractClassName(node: SyntaxNode): string {
  const nameNode = node.childForFieldName('name')
  return nameNode?.text || 'Anonymous'
}

/**
 * Extract heritage (extends/implements) from class
 */
function extractHeritage(node: SyntaxNode): {
  superClass?: string
  implementsInterfaces: string[]
} {
  const implementsInterfaces: string[] = []
  let superClass: string | undefined

  const heritageNode = node.childForFieldName('heritage') || node.namedChildren.find((c) => c.type === 'class_heritage')
  if (!heritageNode) {
    return { superClass, implementsInterfaces }
  }

  for (const child of heritageNode.children) {
    if (child.type === 'extends_clause') {
      const value = child.childForFieldName('value')
      if (value) {
        superClass = value.text
      }
    } else if (child.type === 'implements_clause') {
      for (const implementsNode of child.namedChildren) {
        implementsInterfaces.push(implementsNode.text)
      }
    }
  }

  return { superClass, implementsInterfaces }
}

/**
 * Extract interface extends
 */
function extractInterfaceExtends(node: SyntaxNode): string | undefined {
  const extendsClause = node.children.find(
    (child) => child.type === 'extends_type_clause'
  )
  if (!extendsClause) return undefined

  const firstExtend = extendsClause.namedChildren[0]
  return firstExtend?.text
}

/**
 * Check if node has a specific modifier
 */
function hasModifier(node: SyntaxNode, modifier: string): boolean {
  for (const child of node.children) {
    if (child.text === modifier) {
      return true
    }
  }
  return false
}

/**
 * Extract methods from class body
 */
function extractMethods(
  bodyNode: SyntaxNode,
  filePath: string
): FunctionDefinition[] {
  const methods: FunctionDefinition[] = []

  for (const member of bodyNode.namedChildren) {
    if (member.type === 'method_definition') {
      const name = member.childForFieldName('name')?.text || 'unknown'
      const paramsNode = member.childForFieldName('parameters')
      const params = extractParameters(paramsNode)
      const returnType = extractReturnType(member)
      const location = createSourceLocation(member, filePath)
      const async = isAsync(member)

      const metrics = computeFunctionMetrics(member)

      methods.push({
        name,
        params,
        returnType,
        isExported: false, // Methods aren't directly exported
        isAsync: async,
        location,
        lineCount: metrics.lineCount,
        statementCount: metrics.statementCount,
        maxNestingDepth: metrics.maxNestingDepth,
      })
    }

    // Arrow function properties: e.g. getAll = async (req, res) => { ... }
    if (member.type === 'public_field_definition' || member.type === 'field_definition') {
      const value = member.childForFieldName('value')
      if (value && (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function')) {
        const name = member.childForFieldName('name')?.text || member.childForFieldName('property')?.text || 'unknown'
        const paramsNode = value.childForFieldName('parameters')
        const params = extractParameters(paramsNode)
        const returnType = extractReturnType(value)
        const location = createSourceLocation(member, filePath)
        const async = isAsync(value)

        const metrics = computeFunctionMetrics(value)

        methods.push({
          name,
          params,
          returnType,
          isExported: false,
          isAsync: async,
          location,
          lineCount: metrics.lineCount,
          statementCount: metrics.statementCount,
          maxNestingDepth: metrics.maxNestingDepth,
        })
      }
    }
  }

  return methods
}

/**
 * Extract properties from class body
 */
function extractProperties(
  bodyNode: SyntaxNode,
): ClassProperty[] {
  const properties: ClassProperty[] = []

  for (const member of bodyNode.namedChildren) {
    if (member.type === 'public_field_definition' || member.type === 'field_definition') {
      // Skip arrow function properties — they're extracted as methods
      const value = member.childForFieldName('value')
      if (value && (value.type === 'arrow_function' || value.type === 'function_expression' || value.type === 'function')) {
        continue
      }

      const name = member.childForFieldName('name')?.text || member.childForFieldName('property')?.text || 'unknown'
      const typeAnnotation = member.childForFieldName('type')
      const type = typeAnnotation?.text?.replace(/^:\s*/, '')
      const isStatic = hasModifier(member, 'static')

      properties.push({
        name,
        type,
        isStatic,
      })
    }
  }

  return properties
}

/**
 * Extract import source (the module path)
 */
function extractImportSource(node: SyntaxNode): string {
  const sourceNode = node.childForFieldName('source')
  if (!sourceNode) return ''

  const text = sourceNode.text
  return text.replace(/^['"]|['"]$/g, '')
}

/**
 * Extract named imports from import statement
 */
function extractNamedImports(node: SyntaxNode): ImportSpecifier[] {
  const imports: ImportSpecifier[] = []

  for (const child of node.children) {
    if (child.type === 'import_clause') {
      // Default import
      const defaultImport = child.children.find(
        (c) => c.type === 'identifier' && c.parent?.type === 'import_clause'
      )
      if (defaultImport) {
        imports.push({
          name: defaultImport.text,
          isDefault: true,
          isNamespace: false,
        })
      }

      // Named imports
      const namedImports = child.children.find((c) => c.type === 'named_imports')
      if (namedImports) {
        for (const specifier of namedImports.children) {
          if (specifier.type === 'import_specifier') {
            const name = specifier.childForFieldName('name')?.text
            const alias = specifier.childForFieldName('alias')?.text

            if (name) {
              const importItem: ImportSpecifier = {
                name,
                isDefault: false,
                isNamespace: false,
              }
              if (alias) {
                importItem.alias = alias
              }
              imports.push(importItem)
            }
          }
        }
      }

      // Namespace import (import * as name)
      const namespaceImport = child.children.find(
        (c) => c.type === 'namespace_import'
      )
      if (namespaceImport) {
        const name = namespaceImport.children.find((c) => c.type === 'identifier')
        if (name) {
          imports.push({
            name: name.text,
            isDefault: false,
            isNamespace: true,
          })
        }
      }
    }
  }

  return imports
}

/**
 * Extract export name from export statement
 */
function extractExportName(node: SyntaxNode): string | null {
  // export function name() {}
  const declaration = node.childForFieldName('declaration')
  if (declaration) {
    const name = declaration.childForFieldName('name')
    return name?.text || null
  }

  // export { name }
  const exportClause = node.children.find((c) => c.type === 'export_clause')
  if (exportClause) {
    const specifier = exportClause.children.find((c) => c.type === 'export_specifier')
    if (specifier) {
      const name = specifier.childForFieldName('name')
      return name?.text || null
    }
  }

  return null
}

/**
 * Check if export is default export
 */
function isDefaultExport(node: SyntaxNode): boolean {
  for (const child of node.children) {
    if (child.type === 'default' || child.text === 'default') {
      return true
    }
  }
  return false
}

/**
 * Extract re-export source if applicable
 */
function extractReexportSource(node: SyntaxNode): string | undefined {
  const sourceNode = node.childForFieldName('source')
  if (!sourceNode) return undefined

  const text = sourceNode.text
  return text.replace(/^['"]|['"]$/g, '')
}

/**
 * Check if import is type-only
 */
function isTypeOnlyImport(node: SyntaxNode): boolean {
  for (const child of node.children) {
    if (child.text === 'type' && child.type === 'type') {
      return true
    }
  }
  return false
}

/**
 * Extract decorators from a node
 */
function extractDecorators(node: SyntaxNode): string[] {
  const decorators: string[] = []
  for (const child of node.children) {
    if (child.type === 'decorator') {
      decorators.push(child.text)
    }
  }
  return decorators
}

/**
 * Extract all TypeScript functions from an AST
 */
export function extractTypeScriptFunctions(
  tree: Tree,
  filePath: string,
  language: TSLanguage = 'typescript',
): FunctionDefinition[] {
  const config = getLanguageConfig(language)
  const functions: FunctionDefinition[] = []
  const seenLocations = new Set<string>()

  const queryString =
    config.functionQuery ||
    config.functionNodeTypes.map((type) => `(${type}) @function`).join('\n')

  const parser = getParser(language)
  const tsLanguage = parser.getLanguage()
  const query = new Parser.Query(tsLanguage, queryString)

  const captures = query.captures(tree.rootNode)

  for (const capture of captures) {
    const node = capture.node

    if (!config.functionNodeTypes.includes(node.type)) {
      continue
    }

    const location = createSourceLocation(node, filePath)
    const locationKey = `${location.startLine}:${location.startColumn}`
    if (seenLocations.has(locationKey)) continue
    seenLocations.add(locationKey)

    const name = extractFunctionName(node)
    const paramsNode = node.childForFieldName('parameters')
    const params = extractParameters(paramsNode)
    const returnType = extractReturnType(node)
    const exported = isExported(node)
    const async = isAsync(node)

    const metrics = computeFunctionMetrics(node)

    functions.push({
      name,
      params,
      returnType,
      isExported: exported,
      isAsync: async,
      location,
      lineCount: metrics.lineCount,
      statementCount: metrics.statementCount,
      maxNestingDepth: metrics.maxNestingDepth,
    })
  }

  return functions
}

/**
 * Extract all TypeScript classes from an AST
 */
export function extractTypeScriptClasses(
  tree: Tree,
  filePath: string,
  language: TSLanguage = 'typescript',
): ClassDefinition[] {
  const config = getLanguageConfig(language)
  const classes: ClassDefinition[] = []

  const queryString =
    config.classQuery ||
    config.classNodeTypes.map((type) => `(${type}) @class`).join('\n')

  const parser = getParser(language)
  const tsLanguage = parser.getLanguage()
  const query = new Parser.Query(tsLanguage, queryString)

  const captures = query.captures(tree.rootNode)

  for (const capture of captures) {
    const node = capture.node

    if (!config.classNodeTypes.includes(node.type)) {
      continue
    }

    const name = extractClassName(node)
    const location = createSourceLocation(node, filePath)
    const decorators = extractDecorators(node)

    // Extract heritage
    let superClass: string | undefined
    let interfaces: string[] = []

    if (node.type === 'class_declaration' || node.type === 'abstract_class_declaration') {
      const heritage = extractHeritage(node)
      superClass = heritage.superClass
      interfaces = heritage.implementsInterfaces
    } else if (node.type === 'interface_declaration') {
      superClass = extractInterfaceExtends(node)
    }

    // Extract body
    const bodyNode = node.childForFieldName('body')
    const methods = bodyNode ? extractMethods(bodyNode, filePath) : []
    const properties = bodyNode ? extractProperties(bodyNode) : []

    classes.push({
      name,
      methods,
      properties,
      superClass,
      interfaces: interfaces.length > 0 ? interfaces : undefined,
      decorators: decorators.length > 0 ? decorators : undefined,
      location,
    })
  }

  return classes
}

/**
 * Extract all TypeScript imports from an AST
 */
export function extractTypeScriptImports(
  tree: Tree,
  filePath: string,
  language: TSLanguage = 'typescript',
): ImportStatement[] {
  const config = getLanguageConfig(language)
  const imports: ImportStatement[] = []

  const queryString =
    config.importQuery ||
    config.importNodeTypes.map((type) => `(${type}) @import`).join('\n')

  const parser = getParser(language)
  const tsLanguage = parser.getLanguage()
  const query = new Parser.Query(tsLanguage, queryString)

  const captures = query.captures(tree.rootNode)

  for (const capture of captures) {
    const node = capture.node

    if (node.type !== 'import_statement') {
      continue
    }

    const source = extractImportSource(node)
    const specifiers = extractNamedImports(node)
    const isTypeOnly = isTypeOnlyImport(node)

    if (source && specifiers.length > 0) {
      imports.push({
        source,
        specifiers,
        isTypeOnly,
      })
    }
  }

  return imports
}

/**
 * Extract all TypeScript exports from an AST
 */
export function extractTypeScriptExports(
  tree: Tree,
  _filePath: string,
  language: TSLanguage = 'typescript',
): ExportStatement[] {
  const config = getLanguageConfig(language)
  const exports: ExportStatement[] = []

  const queryString =
    config.exportQuery ||
    config.exportNodeTypes.map((type) => `(${type}) @export`).join('\n')

  const parser = getParser(language)
  const tsLanguage = parser.getLanguage()
  const query = new Parser.Query(tsLanguage, queryString)

  const captures = query.captures(tree.rootNode)

  for (const capture of captures) {
    const node = capture.node

    if (node.type !== 'export_statement') {
      continue
    }

    const name = extractExportName(node)
    if (!name) continue

    const isDefault = isDefaultExport(node)
    const source = extractReexportSource(node)

    exports.push({
      name,
      isDefault,
      source,
    })
  }

  return exports
}
