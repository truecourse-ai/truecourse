import type { Tree, SyntaxNode } from 'tree-sitter'
import type { CallExpression, SupportedLanguage, SourceLocation } from '@truecourse/shared'
import { extractJsxReferences } from '../ts-compiler.js'
import { getLanguageConfig } from '../language-config.js'

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
