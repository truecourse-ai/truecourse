import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNotImplementedInBoolContextVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/not-implemented-in-bool-context',
  languages: ['python'],
  nodeTypes: ['if_statement', 'assert_statement', 'while_statement'],
  visit(node, filePath, sourceCode) {
    let condNode: import('tree-sitter').SyntaxNode | null = null
    if (node.type === 'assert_statement') {
      condNode = node.namedChildren[0] ?? null
    } else {
      condNode = node.childForFieldName('condition')
    }
    if (!condNode) return null

    if (condNode.type === 'identifier' && condNode.text === 'NotImplemented') {
      return makeViolation(
        this.ruleKey, condNode, filePath, 'high',
        'NotImplemented in boolean context',
        '`NotImplemented` is a truthy singleton, not an exception. Using it in a boolean context is always `True`.',
        sourceCode,
        'Raise `NotImplementedError` instead, or use the correct exception.',
      )
    }

    return null
  },
}
