import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function isLenCall(node: SyntaxNode): boolean {
  if (node.type !== 'call') return false
  const fn = node.childForFieldName('function')
  return fn?.type === 'identifier' && fn.text === 'len'
}

export const pythonLenTestVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/len-test',
  languages: ['python'],
  nodeTypes: ['if_statement', 'while_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    // Direct: if len(x)
    if (isLenCall(condition)) {
      return makeViolation(
        this.ruleKey, condition, filePath, 'low',
        'len() used as boolean test',
        '`len(x)` in a boolean context is non-idiomatic. Python objects evaluate as falsy when empty.',
        sourceCode,
        'Replace `if len(x):` with `if x:` and `if not len(x):` with `if not x:`.',
      )
    }

    // Negated: if not len(x)
    if (condition.type === 'not_operator') {
      const inner = condition.namedChildren[0]
      if (inner && isLenCall(inner)) {
        return makeViolation(
          this.ruleKey, condition, filePath, 'low',
          'len() used as boolean test',
          '`not len(x)` in a boolean context is non-idiomatic. Python objects evaluate as falsy when empty.',
          sourceCode,
          'Replace `if not len(x):` with `if not x:`.',
        )
      }
    }

    return null
  },
}
