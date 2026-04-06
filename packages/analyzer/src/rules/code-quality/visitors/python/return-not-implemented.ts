import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

// Binary special methods that should return NotImplemented (not raise)
const BINARY_SPECIAL_METHODS = new Set([
  '__lt__', '__le__', '__eq__', '__ne__', '__gt__', '__ge__',
  '__add__', '__radd__', '__sub__', '__rsub__', '__mul__', '__rmul__',
  '__truediv__', '__rtruediv__', '__floordiv__', '__rfloordiv__',
  '__mod__', '__rmod__', '__pow__', '__rpow__', '__matmul__', '__rmatmul__',
  '__lshift__', '__rlshift__', '__rshift__', '__rrshift__',
  '__and__', '__rand__', '__or__', '__ror__', '__xor__', '__rxor__',
])

function containsRaiseNotImplementedError(body: SyntaxNode): SyntaxNode | null {
  for (const stmt of body.namedChildren) {
    if (stmt.type === 'raise_statement') {
      const exc = stmt.namedChildren[0]
      if (!exc) continue
      if (exc.type === 'call') {
        const fn = exc.childForFieldName('function')
        if (fn?.type === 'identifier' && fn.text === 'NotImplementedError') {
          return stmt
        }
      }
      if (exc.type === 'identifier' && exc.text === 'NotImplementedError') {
        return stmt
      }
    }
  }
  return null
}

export const pythonReturnNotImplementedVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/return-not-implemented',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    if (!nameNode) return null
    const name = nameNode.text

    if (!BINARY_SPECIAL_METHODS.has(name)) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const raiseNode = containsRaiseNotImplementedError(body)
    if (!raiseNode) return null

    return makeViolation(
      this.ruleKey, raiseNode, filePath, 'medium',
      'Special method should return NotImplemented',
      `\`${name}\` raises \`NotImplementedError\` but should \`return NotImplemented\`. Returning \`NotImplemented\` allows Python to try the reflected operation on the other operand.`,
      sourceCode,
      `Replace \`raise NotImplementedError()\` with \`return NotImplemented\` in \`${name}\`.`,
    )
  },
}
