import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { TS_LANGUAGES } from './_helpers.js'

/**
 * Detect: Function returns different types from different paths.
 * Corresponds to sonarjs S3800 (function-return-type).
 * Uses type query to check the return type of the function.
 */

/** Normalize TypeScript literal types to their base types */
function normalizeType(typeStr: string): string {
  // String literal types: "hello", 'world' → string
  if (/^["']/.test(typeStr)) return 'string'
  // Number literal types: 42, 3.14 → number
  if (/^-?\d/.test(typeStr)) return 'number'
  // Boolean literal types
  if (typeStr === 'true' || typeStr === 'false') return 'boolean'
  return typeStr
}

function collectReturnStatements(node: SyntaxNode): SyntaxNode[] {
  const returns: SyntaxNode[] = []
  function walk(n: SyntaxNode) {
    if (n.type === 'return_statement') {
      returns.push(n)
      return
    }
    // Don't descend into nested functions
    if (n.type === 'function_declaration' || n.type === 'function_expression' ||
        n.type === 'arrow_function' || n.type === 'method_definition') {
      return
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(node)
  return returns
}

export const functionReturnTypeVariesVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/function-return-type-varies',
  languages: TS_LANGUAGES,
  nodeTypes: ['function_declaration', 'method_definition'],
  needsTypeQuery: true,
  visit(node, filePath, sourceCode, _dataFlow, typeQuery) {
    if (!typeQuery) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const returnStmts = collectReturnStatements(body)
    if (returnStmts.length < 2) return null

    // Get types of each return value
    const returnTypes = new Set<string>()
    for (const ret of returnStmts) {
      const value = ret.namedChildren[0]
      if (!value) {
        returnTypes.add('undefined')
        continue
      }
      const typeStr = typeQuery.getTypeAtPosition(
        filePath,
        value.startPosition.row,
        value.startPosition.column,
        value.endPosition.row,
        value.endPosition.column,
      )
      if (typeStr) {
        // Normalize literal types to their base types:
        // "hello" → string, 42 → number, true → boolean
        returnTypes.add(normalizeType(typeStr))
      }
    }

    // Skip when ALL returns use the same constructor/function call (e.g., all NextResponse.json(...))
    const returnCallNames = new Set<string>()
    let allReturnsAreCallsToSameFunction = true
    for (const ret of returnStmts) {
      const value = ret.namedChildren[0]
      if (!value || value.type !== 'call_expression') {
        allReturnsAreCallsToSameFunction = false
        break
      }
      const callee = value.childForFieldName('function')
      if (!callee) {
        allReturnsAreCallsToSameFunction = false
        break
      }
      returnCallNames.add(callee.text)
    }
    if (allReturnsAreCallsToSameFunction && returnCallNames.size === 1) return null

    // If there are significantly different base types
    if (returnTypes.size > 1) {
      const types = [...returnTypes]
      const baseTypes = types.filter(t => t !== 'null' && t !== 'undefined')

      // Normalize base types: treat empty arrays as compatible with any array type,
      // and objects with same keys but different boolean literal values as same type
      const normalizedBaseTypes = new Set(baseTypes.map(t => {
        // Treat empty array literal types (e.g., "never[]") as "array"
        if (t === 'never[]' || t === '[]') return 'array'
        // Normalize any array type to "array" so they compare equal to empty arrays
        if (t.endsWith('[]')) return 'array'
        return t
      }))

      // Allow nullable returns (type | null), but flag truly mixed returns (string | number)
      if (normalizedBaseTypes.size > 1) {
        const nameNode = node.childForFieldName('name')
        const fnName = nameNode?.text ?? '<anonymous>'
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Function returns different types',
          `Function \`${fnName}\` returns \`${types.join(' | ')}\` from different code paths — this makes the return type unpredictable.`,
          sourceCode,
          'Ensure consistent return types or explicitly type the function return.',
        )
      }
    }

    return null
  },
}
