import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: assert condition, 123 or assert condition, [] — non-string assert message

const STRING_TYPES = new Set(['string', 'concatenated_string', 'string_content'])

export const pythonInvalidAssertMessageVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-assert-message',
  languages: ['python'],
  nodeTypes: ['assert_statement'],
  visit(node, filePath, sourceCode) {
    const children = node.namedChildren
    if (children.length < 2) return null

    const message = children[1]
    // Flag non-string literal messages (integers, floats, lists, tuples, dicts)
    if (
      message.type === 'integer' ||
      message.type === 'float' ||
      message.type === 'list' ||
      message.type === 'tuple' ||
      message.type === 'dictionary' ||
      message.type === 'true' ||
      message.type === 'false' ||
      message.type === 'none'
    ) {
      return makeViolation(
        this.ruleKey, message, filePath, 'medium',
        'Invalid assert message literal',
        `The assert message \`${message.text}\` is not a string — it may produce a confusing error output. Use a descriptive string message.`,
        sourceCode,
        'Replace the assert message with a descriptive string.',
      )
    }
    return null
  },
}
