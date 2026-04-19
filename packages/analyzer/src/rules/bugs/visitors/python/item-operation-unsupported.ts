import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects subscript/item operations on literal types that don't support them.
 *
 * Examples:
 *   42[0]          # TypeError — int is not subscriptable
 *   True["x"]      # TypeError — bool is not subscriptable
 *   None[0]        # TypeError — NoneType is not subscriptable
 */
export const pythonItemOperationUnsupportedVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/item-operation-unsupported',
  languages: ['python'],
  nodeTypes: ['subscript'],
  visit(node, filePath, sourceCode) {
    const value = node.childForFieldName('value')
    if (!value) return null

    if (isNonSubscriptableLiteral(value)) {
      return makeViolation(
        this.ruleKey,
        node,
        filePath,
        'high',
        'Item operation on unsupported type',
        `\`${value.text}\` (${value.type}) does not support subscript operations — \`TypeError\` at runtime.`,
        sourceCode,
        'Use a subscriptable type (list, dict, string, tuple) or remove the subscript.',
      )
    }

    return null
  },
}

function isNonSubscriptableLiteral(node: SyntaxNode): boolean {
  return (
    node.type === 'integer' ||
    node.type === 'float' ||
    node.type === 'true' ||
    node.type === 'false' ||
    node.type === 'none'
  )
}
