/**
 * JavaScript extractors
 * JavaScript AST structure is similar to TypeScript but uses a different parser
 */
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
} from '@truecourse/shared'
import { getLanguageConfig } from '../../language-config.js'
import { getParser } from '../../parser.js'
import { createSourceLocation, extractDocComment, computeFunctionMetrics } from './common.js'

/**
 * Extract function name from node.
 * For arrow functions / function expressions, check parent context:
 *  - variable_declarator: `const foo = () => {}` → "foo"
 *  - pair (object literal): `{ foo: () => {} }` → "foo"
 *  - assignment_expression: `obj.foo = () => {}` → "foo"
 *  - argument in a method call: `router.get('/', () => {})` → "get_handler"
 */
function extractFunctionName(node: SyntaxNode): string {
  const nameNode = node.childForFieldName('name')
  if (nameNode?.text) return nameNode.text

  const parent = node.parent
  if (!parent) return 'anonymous'

  if (parent.type === 'variable_declarator') {
    const varName = parent.childForFieldName('name')
    if (varName?.text) return varName.text
  }

  if (parent.type === 'pair') {
    const key = parent.childForFieldName('key')
    if (key?.text) return key.text
  }

  if (parent.type === 'assignment_expression') {
    const left = parent.childForFieldName('left')
    if (left?.type === 'member_expression') {
      const prop = left.childForFieldName('property')
      if (prop?.text) return prop.text
    }
  }

  if (parent.type === 'arguments') {
    const callNode = parent.parent
    if (callNode?.type === 'call_expression') {
      const callee = callNode.childForFieldName('function')
      if (callee?.type === 'member_expression') {
        const method = callee.childForFieldName('property')
        if (method?.text) return `${method.text}_handler`
      }
    }
  }

  return 'anonymous'
}

/**
 * Check if function is exported
 */
function isExported(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent

  while (current) {
    if (current.type === 'export_statement') {
      return true
    }
    current = current.parent
  }

  return false
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
 * Extract parameters from JavaScript function
 */
function extractParameters(paramsNode: SyntaxNode | null): Parameter[] {
  if (!paramsNode) return []

  const parameters: Parameter[] = []

  for (const child of paramsNode.namedChildren) {
    if (child.type === 'required_parameter' || child.type === 'optional_parameter') {
      const pattern = child.childForFieldName('pattern')
      const value = child.childForFieldName('value')

      const name = pattern?.text || 'unknown'
      const defaultValue = value?.text

      parameters.push({
        name,
        type: undefined, // JavaScript doesn't have type annotations
        defaultValue,
      })
    }
  }

  return parameters
}

/**
 * Extract JavaScript functions
 */
export function extractJavaScriptFunctions(
  tree: Tree,
  filePath: string
): FunctionDefinition[] {
  const config = getLanguageConfig('javascript')
  const functions: FunctionDefinition[] = []

  const queryString =
    config.functionQuery ||
    config.functionNodeTypes.map((type) => `(${type}) @function`).join('\n')

  const parser = getParser('javascript')
  const jsLanguage = parser.getLanguage()
  const query = new Parser.Query(jsLanguage, queryString)

  const captures = query.captures(tree.rootNode)

  for (const capture of captures) {
    const node = capture.node

    if (!config.functionNodeTypes.includes(node.type)) {
      continue
    }

    const name = extractFunctionName(node)
    const paramsNode = node.childForFieldName('parameters')
    const params = extractParameters(paramsNode)
    const location = createSourceLocation(node, filePath)
    const exported = isExported(node)
    const async = isAsync(node)

    const metrics = computeFunctionMetrics(node)

    functions.push({
      name,
      params,
      returnType: undefined, // JavaScript doesn't have return types
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
 * Extract class name from node
 */
function extractClassName(node: SyntaxNode): string {
  const nameNode = node.childForFieldName('name')
  return nameNode?.text || 'Anonymous'
}

/**
 * Extract heritage (extends) from class
 */
function extractHeritage(node: SyntaxNode): {
  superClass?: string
} {
  let superClass: string | undefined

  const heritageNode = node.childForFieldName('heritage')
  if (!heritageNode) {
    return { superClass }
  }

  for (const child of heritageNode.children) {
    if (child.type === 'extends_clause') {
      const value = child.childForFieldName('value')
      if (value) {
        superClass = value.text
      }
    }
  }

  return { superClass }
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
      const location = createSourceLocation(member, filePath)
      const async = isAsync(member)

      const metrics = computeFunctionMetrics(member)

      methods.push({
        name,
        params,
        returnType: undefined,
        isExported: false,
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
        const location = createSourceLocation(member, filePath)
        const async = isAsync(value)

        const metrics = computeFunctionMetrics(value)

        methods.push({
          name,
          params,
          returnType: undefined,
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
      const isStatic = hasModifier(member, 'static')

      properties.push({
        name,
        type: undefined, // JavaScript doesn't have type annotations
        isStatic,
      })
    }
  }

  return properties
}

/**
 * Extract JavaScript classes
 */
export function extractJavaScriptClasses(
  tree: Tree,
  filePath: string
): ClassDefinition[] {
  const config = getLanguageConfig('javascript')
  const classes: ClassDefinition[] = []

  const queryString =
    config.classQuery ||
    config.classNodeTypes.map((type) => `(${type}) @class`).join('\n')

  const parser = getParser('javascript')
  const jsLanguage = parser.getLanguage()
  const query = new Parser.Query(jsLanguage, queryString)

  const captures = query.captures(tree.rootNode)

  for (const capture of captures) {
    const node = capture.node

    if (!config.classNodeTypes.includes(node.type)) {
      continue
    }

    const name = extractClassName(node)
    const location = createSourceLocation(node, filePath)

    const heritage = extractHeritage(node)

    const bodyNode = node.childForFieldName('body')
    const methods = bodyNode ? extractMethods(bodyNode, filePath) : []
    const properties = bodyNode ? extractProperties(bodyNode) : []

    classes.push({
      name,
      methods,
      properties,
      superClass: heritage.superClass,
      interfaces: undefined, // JavaScript doesn't have implements
      decorators: undefined,
      location,
    })
  }

  return classes
}

/**
 * Extract import source
 */
function extractImportSource(node: SyntaxNode): string {
  const sourceNode = node.childForFieldName('source')
  if (!sourceNode) return ''

  const text = sourceNode.text
  return text.replace(/^['"]|['"]$/g, '')
}

/**
 * Extract named imports
 */
function extractNamedImports(node: SyntaxNode): ImportSpecifier[] {
  const imports: ImportSpecifier[] = []

  for (const child of node.children) {
    if (child.type === 'import_clause') {
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
 * Extract JavaScript imports
 */
export function extractJavaScriptImports(
  tree: Tree,
  _filePath: string
): ImportStatement[] {
  const config = getLanguageConfig('javascript')
  const imports: ImportStatement[] = []

  const queryString =
    config.importQuery ||
    config.importNodeTypes.map((type) => `(${type}) @import`).join('\n')

  const parser = getParser('javascript')
  const jsLanguage = parser.getLanguage()
  const query = new Parser.Query(jsLanguage, queryString)

  const captures = query.captures(tree.rootNode)

  for (const capture of captures) {
    const node = capture.node

    if (node.type !== 'import_statement') {
      continue
    }

    const source = extractImportSource(node)
    const specifiers = extractNamedImports(node)

    if (source && specifiers.length > 0) {
      imports.push({
        source,
        specifiers,
        isTypeOnly: false, // JavaScript doesn't have type-only imports
      })
    }
  }

  return imports
}

/**
 * Extract export name
 */
function extractExportName(node: SyntaxNode): string | null {
  const declaration = node.childForFieldName('declaration')
  if (declaration) {
    const name = declaration.childForFieldName('name')
    return name?.text || null
  }

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
 * Check if export is default
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
 * Extract re-export source
 */
function extractReexportSource(node: SyntaxNode): string | undefined {
  const sourceNode = node.childForFieldName('source')
  if (!sourceNode) return undefined

  const text = sourceNode.text
  return text.replace(/^['"]|['"]$/g, '')
}

/**
 * Extract JavaScript exports
 */
export function extractJavaScriptExports(
  tree: Tree,
  _filePath: string
): ExportStatement[] {
  const config = getLanguageConfig('javascript')
  const exports: ExportStatement[] = []

  const queryString =
    config.exportQuery ||
    config.exportNodeTypes.map((type) => `(${type}) @export`).join('\n')

  const parser = getParser('javascript')
  const jsLanguage = parser.getLanguage()
  const query = new Parser.Query(jsLanguage, queryString)

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
