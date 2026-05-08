import type { Tree, Node as SyntaxNode } from 'web-tree-sitter'
import type { CallExpression, SupportedLanguage, SourceLocation } from '@truecourse/shared'
import { extractJsxReferences } from '../ts-compiler.js'
import { getLanguageConfig } from '../language-config.js'

/**
 * Walk the AST collecting bare-identifier references that are NOT
 * call expressions — assignment RHS, decorator targets, default
 * parameter values, return values that are pure identifiers.
 *
 * Used by architecture/unused-export to recognize functions
 * registered as callbacks without being invoked at the def site
 * (`sys.excepthook = handler`, `@my_decorator`, etc.).
 *
 * Conservative: only includes positions where an identifier is
 * unambiguously a value reference. Type-annotation contexts are
 * skipped — they're tracked separately by `usedAsType`.
 */
export function extractIdentifierReferences(
  tree: Tree,
  language: SupportedLanguage,
): string[] {
  const refs = new Set<string>()
  if (language !== 'python') return [] // currently Python-only; TS uses TS-compiler-driven cross-references

  const root = tree.rootNode

  function isInsideCallCallee(node: SyntaxNode): boolean {
    // Skip identifiers that are themselves the function position
    // of a call_expression — those are already captured as calls.
    const parent = node.parent
    if (!parent) return false
    if (parent.type === 'call' && parent.childForFieldName('function')?.id === node.id) return true
    return false
  }

  function isInsideTypeAnnotation(node: SyntaxNode): boolean {
    // Walk up to the nearest containing typed_parameter / typed_default_parameter
    // and check whether `node` is inside the type field, not the value field.
    let cursor: SyntaxNode | null = node.parent
    while (cursor) {
      if (cursor.type === 'typed_parameter' || cursor.type === 'typed_default_parameter') {
        const typeNode = cursor.childForFieldName('type')
        if (typeNode) {
          let probe: SyntaxNode | null = node
          while (probe) {
            if (probe.id === typeNode.id) return true
            if (probe.id === cursor.id) break
            probe = probe.parent
          }
        }
        return false
      }
      if (cursor.type === 'function_definition' || cursor.type === 'class_definition' || cursor.type === 'module') break
      cursor = cursor.parent
    }
    return false
  }

  function visit(node: SyntaxNode): void {
    // Assignment RHS: `sys.excepthook = handler`
    if (node.type === 'assignment') {
      const right = node.childForFieldName('right')
      if (right) collectFromValue(right)
    }
    // Augmented assignment too: `x += handler` (rare for unused-export).
    if (node.type === 'augmented_assignment') {
      const right = node.childForFieldName('right')
      if (right) collectFromValue(right)
    }
    // Decorator targets: `@my_decorator` — the decorator's child is
    // the identifier or call. We want the bare identifier ref.
    if (node.type === 'decorator') {
      // decorator child[1] is the expression (skip the '@' anonymous child)
      for (const c of node.namedChildren) {
        collectFromValue(c)
      }
    }
    // Default parameter values: `def f(x=handler)` — value field of
    // default_parameter / typed_default_parameter / lambda_parameters.
    if (node.type === 'default_parameter' || node.type === 'typed_default_parameter') {
      const value = node.childForFieldName('value')
      if (value) collectFromValue(value)
    }
    for (const c of node.namedChildren) visit(c)
  }

  function collectFromValue(node: SyntaxNode): void {
    if (node.type === 'identifier') {
      if (!isInsideCallCallee(node) && !isInsideTypeAnnotation(node)) {
        refs.add(node.text)
      }
      return
    }
    // Tuples / lists of identifiers: `[h1, h2]` / `(a, b)`
    if (node.type === 'tuple' || node.type === 'list') {
      for (const c of node.namedChildren) collectFromValue(c)
      return
    }
    // Conditional expression: `a if cond else b`
    if (node.type === 'conditional_expression') {
      for (const c of node.namedChildren) collectFromValue(c)
      return
    }
    // Don't descend into arbitrary expressions — only direct value
    // shapes count. Calls / attribute accesses / subscripts are NOT
    // counted as references for this purpose; they have their own
    // handling.
  }

  visit(root)
  return [...refs]
}

/**
 * Extract all function/method calls from an AST
 */
export function extractCalls(
  tree: Tree,
  filePath: string,
  _language: SupportedLanguage,
  functionContext: Map<number, string> // Map of line number to function/method name
): CallExpression[] {
  const sourceCode = tree.rootNode.text
  const calls: CallExpression[] = []
  const callNodeTypes = new Set(getLanguageConfig(_language).callNodeTypes)

  // Traverse the tree to find call expressions
  function traverse(node: SyntaxNode) {
    if (callNodeTypes.has(node.type)) {
      const call = extractCallExpression(node, filePath, sourceCode, functionContext)
      if (call) {
        calls.push(call)
      }
    }

    for (const child of node.children) {
      traverse(child)
    }
  }

  traverse(tree.rootNode)

  // Extract JSX references using the TypeScript compiler AST.
  // extractJsxReferences returns empty for non-TSX/JSX files.
  const jsxRefs = extractJsxReferences(sourceCode, filePath)
  for (const ref of jsxRefs) {
    const callerName = functionContext.get(ref.line) || undefined
    calls.push({
      callee: ref.callee,
      location: {
        filePath,
        startLine: ref.line + 1,
        endLine: ref.line + 1,
        startColumn: ref.column,
        endColumn: ref.column,
      },
      callerFunction: callerName,
    })
  }

  return calls
}

/**
 * Extract a single call expression from a node
 */
function extractCallExpression(
  callNode: SyntaxNode,
  filePath: string,
  sourceCode: string,
  functionContext: Map<number, string>
): CallExpression | null {
  const functionNode = callNode.childForFieldName('function')
  const argumentsNode = callNode.childForFieldName('arguments')

  if (!functionNode) return null

  // Determine caller (which function/method contains this call)
  const callerLine = callNode.startPosition.row
  const callerName = functionContext.get(callerLine) || undefined

  // Extract callee information
  let calleeName = ''

  // Check if it's a method call (obj.method()) or function call (func())
  const MEMBER_ACCESS_TYPES = new Set(['member_expression', 'attribute'])
  if (MEMBER_ACCESS_TYPES.has(functionNode.type)) {
    // Method call: obj.method()
    const objectNode = functionNode.childForFieldName('object')
    const propertyNode = functionNode.childForFieldName('property') || functionNode.childForFieldName('attribute')

    if (objectNode && propertyNode) {
      const receiver = sourceCode.slice(objectNode.startIndex, objectNode.endIndex)
      const method = sourceCode.slice(propertyNode.startIndex, propertyNode.endIndex)
      calleeName = `${receiver}.${method}`
    }
  } else {
    // Regular function call: func()
    calleeName = sourceCode.slice(functionNode.startIndex, functionNode.endIndex)
  }

  // Extract arguments
  const args: string[] = []
  if (argumentsNode) {
    for (const argNode of argumentsNode.namedChildren) {
      const argText = sourceCode.slice(argNode.startIndex, argNode.endIndex)
      args.push(argText)
    }
  }

  // Get location
  const location: SourceLocation = {
    filePath,
    startLine: callNode.startPosition.row + 1,
    endLine: callNode.endPosition.row + 1,
    startColumn: callNode.startPosition.column,
    endColumn: callNode.endPosition.column,
  }

  return {
    callee: calleeName,
    arguments: args.length > 0 ? args : undefined,
    location,
    callerFunction: callerName,
  }
}

/**
 * Build a map of line numbers to function/method names for context
 */
export function buildFunctionContext(
  functions: Array<{ name: string; location: SourceLocation }>,
  classes: Array<{ name: string; methods: Array<{ name: string; location: SourceLocation }> }>
): Map<number, string> {
  const context = new Map<number, string>()

  // Add standalone functions — skip anonymous functions so they don't overwrite
  // the enclosing named function's context. This ensures calls inside useEffect
  // callbacks, inline handlers, etc. are attributed to the parent component/function.
  for (const func of functions) {
    if (func.name === 'anonymous') continue
    for (let line = func.location.startLine; line <= func.location.endLine; line++) {
      context.set(line - 1, func.name) // Tree-sitter uses 0-indexed lines
    }
  }

  // Add class methods
  for (const cls of classes) {
    for (const method of cls.methods) {
      if (method.name === 'anonymous') continue
      for (let line = method.location.startLine; line <= method.location.endLine; line++) {
        context.set(line - 1, `${cls.name}.${method.name}`)
      }
    }
  }

  return context
}
