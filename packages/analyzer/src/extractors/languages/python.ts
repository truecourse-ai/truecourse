/**
 * Python language extractor for tree-sitter AST.
 *
 * Extracts functions, classes, imports, and exports from Python source files.
 * Export detection uses the underscore convention (no leading _ = public) as a
 * heuristic — the Pyright LSP server overwrites this with accurate export info
 * during analysis, same pattern as the TS compiler overwriting tree-sitter's
 * isExported heuristic for JS/TS files.
 */

import type { Tree, SyntaxNode } from 'tree-sitter'
import type {
  FunctionDefinition,
  ClassDefinition,
  ImportStatement,
  ExportStatement,
  Parameter,
  ClassProperty,
  ImportSpecifier,
} from '@truecourse/shared'
import { createSourceLocation } from './common.js'

// ---------------------------------------------------------------------------
// Python-specific metrics (extends common.ts node types)
// ---------------------------------------------------------------------------

const PYTHON_NESTING_NODE_TYPES = new Set([
  'if_statement',
  'for_statement',
  'while_statement',
  'try_statement',
  'with_statement',
  'match_statement',
])

const PYTHON_STATEMENT_NODE_TYPES = new Set([
  'expression_statement',
  'return_statement',
  'if_statement',
  'for_statement',
  'while_statement',
  'try_statement',
  'with_statement',
  'raise_statement',
  'assert_statement',
  'assignment',
  'augmented_assignment',
  'delete_statement',
  'pass_statement',
  'break_statement',
  'continue_statement',
  'global_statement',
  'nonlocal_statement',
  'match_statement',
])

function computePythonFunctionMetrics(node: SyntaxNode): {
  lineCount: number
  statementCount: number
  maxNestingDepth: number
} {
  const lineCount = node.endPosition.row - node.startPosition.row + 1

  const bodyNode = node.childForFieldName('body')
  if (!bodyNode) {
    return { lineCount, statementCount: 0, maxNestingDepth: 0 }
  }

  let statementCount = 0
  for (const child of bodyNode.namedChildren) {
    if (PYTHON_STATEMENT_NODE_TYPES.has(child.type)) {
      statementCount++
    }
  }

  let maxNestingDepth = 0
  function walkNesting(n: SyntaxNode, depth: number) {
    for (const child of n.namedChildren) {
      if (PYTHON_NESTING_NODE_TYPES.has(child.type)) {
        const newDepth = depth + 1
        if (newDepth > maxNestingDepth) maxNestingDepth = newDepth
        walkNesting(child, newDepth)
      } else {
        walkNesting(child, depth)
      }
    }
  }
  walkNesting(bodyNode, 0)

  return { lineCount, statementCount, maxNestingDepth }
}

// ---------------------------------------------------------------------------
// Helper: check if node is inside a function (not top-level)
// ---------------------------------------------------------------------------

function isNestedInFunction(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (current.type === 'function_definition') return true
    current = current.parent
  }
  return false
}

function isInsideClass(node: SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (current.type === 'class_definition') return true
    current = current.parent
  }
  return false
}

// ---------------------------------------------------------------------------
// Helper: extract Python docstring
// ---------------------------------------------------------------------------

function extractDocstring(node: SyntaxNode): string | undefined {
  const body = node.childForFieldName('body')
  if (!body) return undefined

  const firstChild = body.namedChildren[0]
  if (!firstChild) return undefined

  // Docstrings are expression_statement containing a string
  if (firstChild.type === 'expression_statement') {
    const expr = firstChild.namedChildren[0]
    if (expr?.type === 'string' || expr?.type === 'concatenated_string') {
      return expr.text
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Helper: extract decorators
// ---------------------------------------------------------------------------

function extractDecorators(node: SyntaxNode): string[] {
  const decorators: string[] = []
  // In tree-sitter-python, decorators are children of the decorated_definition
  // or they may be part of the function_definition directly
  let current: SyntaxNode | null = node

  // Check if parent is decorated_definition
  if (node.parent?.type === 'decorated_definition') {
    current = node.parent
  }

  if (!current) return decorators

  for (const child of current.children) {
    if (child.type === 'decorator') {
      // Get the decorator text without the @ prefix
      const text = child.text.replace(/^@/, '')
      decorators.push(text)
    }
  }

  return decorators
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

export function extractPythonFunctions(tree: Tree, filePath: string): FunctionDefinition[] {
  const functions: FunctionDefinition[] = []
  const seen = new Set<string>()

  function visit(node: SyntaxNode) {
    if (node.type === 'function_definition') {
      const key = `${node.startPosition.row}:${node.startPosition.column}`
      if (seen.has(key)) return
      seen.add(key)

      // Skip methods inside classes — they're extracted by extractPythonClasses
      if (node.parent?.type === 'block' && node.parent.parent?.type === 'class_definition') {
        return
      }
      // Also handle decorated methods
      if (
        node.parent?.type === 'decorated_definition' &&
        node.parent.parent?.type === 'block' &&
        node.parent.parent.parent?.type === 'class_definition'
      ) {
        return
      }

      const name = node.childForFieldName('name')?.text
      if (!name) return

      // Skip nested functions (lambdas/closures) — return anonymous
      if (isNestedInFunction(node)) return

      const paramsNode = node.childForFieldName('parameters')
      const params = extractPythonParameters(paramsNode)

      const returnTypeNode = node.childForFieldName('return_type')
      let returnType: string | undefined
      if (returnTypeNode) {
        // return_type includes the "-> " prefix in some grammars
        returnType = returnTypeNode.text.replace(/^->\s*/, '')
      }

      // Check for async: tree-sitter-python includes 'async' as a keyword child
      const isAsyncFn = node.text.trimStart().startsWith('async ')

      const decorators = extractDecorators(node)
      const docComment = extractDocstring(node)
      const metrics = computePythonFunctionMetrics(node)

      // Python export heuristic: public if name doesn't start with _
      const isExported = !name.startsWith('_')

      functions.push({
        name,
        params,
        returnType,
        isAsync: isAsyncFn,
        isExported,
        location: createSourceLocation(node, filePath),
        ...metrics,
      })
    }

    for (const child of node.namedChildren) {
      visit(child)
    }
  }

  visit(tree.rootNode)
  return functions
}

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

function extractPythonParameters(paramsNode: SyntaxNode | null): Parameter[] {
  if (!paramsNode) return []

  const parameters: Parameter[] = []

  for (const child of paramsNode.namedChildren) {
    switch (child.type) {
      case 'identifier': {
        // Simple parameter: def foo(x)
        const name = child.text
        if (name === 'self' || name === 'cls') continue
        parameters.push({ name })
        break
      }

      case 'typed_parameter': {
        // Typed parameter: def foo(x: int)
        const name = child.childForFieldName('name')?.text || child.children[0]?.text
        if (!name || name === 'self' || name === 'cls') continue
        const typeNode = child.childForFieldName('type')
        parameters.push({
          name,
          type: typeNode?.text,
        })
        break
      }

      case 'default_parameter': {
        // Default parameter: def foo(x=5)
        const name = child.childForFieldName('name')?.text
        if (!name || name === 'self' || name === 'cls') continue
        const value = child.childForFieldName('value')
        parameters.push({
          name,
          defaultValue: value?.text,
        })
        break
      }

      case 'typed_default_parameter': {
        // Typed default: def foo(x: int = 5)
        const name = child.childForFieldName('name')?.text
        if (!name || name === 'self' || name === 'cls') continue
        const typeNode = child.childForFieldName('type')
        const value = child.childForFieldName('value')
        parameters.push({
          name,
          type: typeNode?.text,
          defaultValue: value?.text,
        })
        break
      }

      case 'list_splat_pattern': {
        // *args
        const name = child.namedChildren[0]?.text
        if (name) {
          parameters.push({ name: `*${name}` })
        }
        break
      }

      case 'dictionary_splat_pattern': {
        // **kwargs
        const name = child.namedChildren[0]?.text
        if (name) {
          parameters.push({ name: `**${name}` })
        }
        break
      }
    }
  }

  return parameters
}

// ---------------------------------------------------------------------------
// Classes
// ---------------------------------------------------------------------------

export function extractPythonClasses(tree: Tree, filePath: string): ClassDefinition[] {
  const classes: ClassDefinition[] = []
  const seen = new Set<string>()

  function visit(node: SyntaxNode) {
    if (node.type === 'class_definition') {
      const key = `${node.startPosition.row}:${node.startPosition.column}`
      if (seen.has(key)) return
      seen.add(key)

      const name = node.childForFieldName('name')?.text
      if (!name) return

      // Extract superclass from superclasses (argument_list)
      let superClass: string | undefined
      const interfaces: string[] = []
      const superclassesNode = node.childForFieldName('superclasses')
      if (superclassesNode) {
        const bases = superclassesNode.namedChildren
        if (bases.length > 0) {
          superClass = bases[0].text
          // Additional bases could be interfaces/mixins
          for (let i = 1; i < bases.length; i++) {
            interfaces.push(bases[i].text)
          }
        }
      }

      const body = node.childForFieldName('body')
      const methods = extractClassMethods(body, filePath)
      const properties = extractClassProperties(body)
      const decorators = extractDecorators(node)
      const docComment = extractDocstring(node)

      const isExported = !name.startsWith('_')

      classes.push({
        name,
        methods,
        properties,
        superClass,
        interfaces,
        decorators,
        location: createSourceLocation(node, filePath),
      })
    }

    // Don't recurse into nested classes from here — they'll be visited at top level
    if (node.type !== 'class_definition') {
      for (const child of node.namedChildren) {
        visit(child)
      }
    } else {
      // Still visit children for nested classes
      for (const child of node.namedChildren) {
        visit(child)
      }
    }
  }

  visit(tree.rootNode)
  return classes
}

function extractClassMethods(
  body: SyntaxNode | null,
  filePath: string,
): FunctionDefinition[] {
  if (!body) return []

  const methods: FunctionDefinition[] = []

  for (const child of body.namedChildren) {
    let funcNode: SyntaxNode | null = null

    if (child.type === 'function_definition') {
      funcNode = child
    } else if (child.type === 'decorated_definition') {
      // Find the function_definition inside the decorated_definition
      for (const sub of child.namedChildren) {
        if (sub.type === 'function_definition') {
          funcNode = sub
          break
        }
      }
    }

    if (!funcNode) continue

    const name = funcNode.childForFieldName('name')?.text
    if (!name) continue

    const paramsNode = funcNode.childForFieldName('parameters')
    const params = extractPythonParameters(paramsNode)

    const returnTypeNode = funcNode.childForFieldName('return_type')
    let returnType: string | undefined
    if (returnTypeNode) {
      returnType = returnTypeNode.text.replace(/^->\s*/, '')
    }

    const isAsyncFn = funcNode.text.trimStart().startsWith('async ')
    const metrics = computePythonFunctionMetrics(funcNode)

    methods.push({
      name,
      params,
      returnType,
      isAsync: isAsyncFn,
      isExported: true,
      location: createSourceLocation(funcNode, filePath),
      ...metrics,
    })
  }

  return methods
}

function extractClassProperties(body: SyntaxNode | null): ClassProperty[] {
  if (!body) return []

  const properties: ClassProperty[] = []

  for (const child of body.namedChildren) {
    if (child.type === 'expression_statement') {
      const expr = child.namedChildren[0]
      if (!expr) continue

      if (expr.type === 'assignment') {
        // x = Column(String) or x: str = "value"
        const left = expr.childForFieldName('left')
        const right = expr.childForFieldName('right')
        if (left && left.type === 'identifier') {
          properties.push({
            name: left.text,
            type: right?.text,
          })
        }
      } else if (expr.type === 'type_alias_statement' || expr.type === 'annotated_assignment') {
        // x: int = 5 or x: int
        // In tree-sitter-python this might be under different node types
      }
    }

    // Handle type annotations: x: int = 5
    if (child.type === 'type_alias_statement') {
      const name = child.childForFieldName('name')?.text
      if (name) {
        properties.push({
          name,
        })
      }
    }
  }

  return properties
}

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

export function extractPythonImports(tree: Tree, filePath: string): ImportStatement[] {
  const imports: ImportStatement[] = []

  function visit(node: SyntaxNode) {
    if (node.type === 'import_statement') {
      // import foo
      // import foo.bar
      // import foo as bar
      const specifiers: ImportSpecifier[] = []

      for (const child of node.namedChildren) {
        if (child.type === 'dotted_name') {
          specifiers.push({
            name: child.text,
            alias: undefined,
            isDefault: false,
            isNamespace: true,
          })
          imports.push({
            source: child.text,
            specifiers,
            isTypeOnly: false,
          })
        } else if (child.type === 'aliased_import') {
          const name = child.childForFieldName('name')?.text || ''
          const alias = child.childForFieldName('alias')?.text
          specifiers.push({
            name,
            alias,
            isDefault: false,
            isNamespace: true,
          })
          imports.push({
            source: name,
            specifiers: [{ name, alias, isDefault: false, isNamespace: true }],
            isTypeOnly: false,
          })
        }
      }
    } else if (node.type === 'import_from_statement') {
      // from foo import bar
      // from foo import bar, baz
      // from foo import bar as b
      // from . import foo
      // from ..module import func
      // from foo import *
      const source = extractImportFromSource(node)
      const specifiers: ImportSpecifier[] = []

      // Find the imported names
      for (const child of node.children) {
        if (child.type === 'dotted_name' && child !== node.children.find((c) => c.type === 'dotted_name')) {
          // Named import
          specifiers.push({
            name: child.text,
            isDefault: false,
            isNamespace: false,
          })
        } else if (child.type === 'aliased_import') {
          const name = child.childForFieldName('name')?.text || ''
          const alias = child.childForFieldName('alias')?.text
          specifiers.push({
            name,
            alias,
            isDefault: false,
            isNamespace: false,
          })
        } else if (child.type === 'wildcard_import') {
          specifiers.push({
            name: '*',
            isDefault: false,
            isNamespace: true,
          })
        }
      }

      // If no specifiers found yet, look for identifier children after 'import' keyword
      if (specifiers.length === 0) {
        let foundImport = false
        for (const child of node.children) {
          if (child.type === 'import') {
            foundImport = true
            continue
          }
          if (foundImport && child.type === 'dotted_name') {
            specifiers.push({
              name: child.text,
              isDefault: false,
              isNamespace: false,
            })
          }
          if (foundImport && child.type === 'aliased_import') {
            const name = child.childForFieldName('name')?.text || ''
            const alias = child.childForFieldName('alias')?.text
            specifiers.push({
              name,
              alias,
              isDefault: false,
              isNamespace: false,
            })
          }
        }
      }

      if (source) {
        imports.push({
          source,
          specifiers,
          isTypeOnly: false,
        })
      }
    }

    for (const child of node.namedChildren) {
      visit(child)
    }
  }

  visit(tree.rootNode)
  return imports
}

/**
 * Extract the module source from a `from X import Y` statement.
 * Handles relative imports (from . import, from ..module import).
 */
function extractImportFromSource(node: SyntaxNode): string | null {
  // The source is the module_name or dotted_name after 'from' and before 'import'
  // In tree-sitter-python, the structure is:
  // (import_from_statement
  //   module_name: (dotted_name) | (relative_import)
  //   name: ...)

  const moduleNode = node.childForFieldName('module_name')
  if (moduleNode) {
    return moduleNode.text
  }

  // Fallback: walk children to find the source between 'from' and 'import'
  let afterFrom = false
  for (const child of node.children) {
    if (child.type === 'from') {
      afterFrom = true
      continue
    }
    if (child.type === 'import') {
      break
    }
    if (afterFrom) {
      if (child.type === 'dotted_name' || child.type === 'relative_import') {
        return child.text
      }
      // Handle bare dots: from . import foo
      if (child.text.match(/^\.+$/)) {
        return child.text
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Extract Python "exports" — Python has no explicit export syntax.
 *
 * Heuristic: all top-level functions, classes, and variable assignments
 * whose names don't start with _ are considered exports.
 * If __all__ is defined, use that as the definitive export list.
 *
 * This heuristic gets overwritten by the Pyright LSP export map during
 * analysis (same pattern as TS compiler overwriting tree-sitter's isExported).
 */
export function extractPythonExports(tree: Tree, filePath: string): ExportStatement[] {
  const exports: ExportStatement[] = []
  const root = tree.rootNode

  // First check for __all__
  const allExports = findDunderAll(root)
  if (allExports) {
    for (const name of allExports) {
      exports.push({ name, isDefault: false })
    }
    return exports
  }

  // Fallback: all public top-level names
  for (const child of root.namedChildren) {
    if (child.type === 'function_definition') {
      const name = child.childForFieldName('name')?.text
      if (name && !name.startsWith('_')) {
        exports.push({ name, isDefault: false })
      }
    } else if (child.type === 'decorated_definition') {
      // Find function/class inside
      for (const sub of child.namedChildren) {
        if (sub.type === 'function_definition' || sub.type === 'class_definition') {
          const name = sub.childForFieldName('name')?.text
          if (name && !name.startsWith('_')) {
            exports.push({ name, isDefault: false })
          }
        }
      }
    } else if (child.type === 'class_definition') {
      const name = child.childForFieldName('name')?.text
      if (name && !name.startsWith('_')) {
        exports.push({ name, isDefault: false })
      }
    } else if (child.type === 'expression_statement') {
      const expr = child.namedChildren[0]
      if (expr?.type === 'assignment') {
        const left = expr.childForFieldName('left')
        if (left?.type === 'identifier' && !left.text.startsWith('_')) {
          exports.push({ name: left.text, isDefault: false })
        }
      }
    }
  }

  return exports
}

/**
 * Parse __all__ = ['foo', 'bar'] to get explicit export list.
 */
function findDunderAll(root: SyntaxNode): string[] | null {
  for (const child of root.namedChildren) {
    if (child.type !== 'expression_statement') continue

    const expr = child.namedChildren[0]
    if (expr?.type !== 'assignment') continue

    const left = expr.childForFieldName('left')
    if (left?.text !== '__all__') continue

    const right = expr.childForFieldName('right')
    if (!right || right.type !== 'list') continue

    const names: string[] = []
    for (const item of right.namedChildren) {
      if (item.type === 'string') {
        // Strip quotes
        const text = item.text.replace(/^['"]|['"]$/g, '')
        if (text) names.push(text)
      }
    }

    return names.length > 0 ? names : null
  }

  return null
}
