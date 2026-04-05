import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonExceptWithEmptyTupleVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/except-with-empty-tuple',
  languages: ['python'],
  nodeTypes: ['except_clause'],
  visit(node, filePath, sourceCode) {
    const children = node.children
    const exceptIdx = children.findIndex((c) => c.text === 'except')
    const colonIdx = children.findIndex((c) => c.text === ':')
    if (exceptIdx === -1 || colonIdx === -1) return null

    const typeNodes = children.slice(exceptIdx + 1, colonIdx).filter((c) => c.type !== 'comment' && c.text !== 'as')
    for (const t of typeNodes) {
      if (t.type === 'tuple' && t.namedChildren.length === 0) {
        return makeViolation(
          this.ruleKey, t, filePath, 'high',
          'Except with empty tuple',
          '`except ():` catches no exceptions — this handler is useless and likely a bug.',
          sourceCode,
          'Add exception types to the tuple or use `except Exception:` to catch all exceptions.',
        )
      }
    }
    return null
  },
}
