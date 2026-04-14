import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: request.headers['X-Header'] — should use request.headers.get('X-Header')

export const pythonFlaskHeaderAccessKeyerrorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/flask-header-access-keyerror',
  languages: ['python'],
  nodeTypes: ['subscript'],
  visit(node, filePath, sourceCode) {
    const value = node.childForFieldName('value')
    if (!value) return null

    // Check for request.headers[...]
    if (value.type !== 'attribute') return null
    const obj = value.childForFieldName('object')
    const attr = value.childForFieldName('attribute')
    if (obj?.text !== 'request' || attr?.text !== 'headers') return null

    const subscriptNode = node.childForFieldName('subscript')
    if (!subscriptNode) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Unsafe Flask header access',
      `\`request.headers[${subscriptNode.text}]\` raises \`KeyError\` if the header is missing. Use \`request.headers.get(${subscriptNode.text})\` instead.`,
      sourceCode,
      `Replace \`request.headers[${subscriptNode.text}]\` with \`request.headers.get(${subscriptNode.text})\`.`,
    )
  },
}
