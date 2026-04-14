import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonUnnecessaryPassVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-pass',
  languages: ['python'],
  nodeTypes: ['pass_statement'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent || parent.type !== 'block') return null

    // If the block has more than just the pass statement, it's unnecessary
    const siblings = parent.namedChildren.filter((c) => c.type !== 'comment')
    if (siblings.length <= 1) return null // Only pass — potentially needed

    // Inside a class body with NO docstring and NO other statements, `pass`
    // is the only body statement and IS needed syntactically. But if there's a
    // docstring, the docstring alone suffices as the class body — `pass` is
    // unnecessary. Only skip when there are truly NO other statements at all.
    const grandparent = parent.parent
    if (grandparent?.type === 'class_definition' || grandparent?.type === 'function_definition') {
      const hasDocstring = siblings.some((c) => {
        if (c.type === 'expression_statement') {
          const inner = c.namedChildren[0]
          return inner?.type === 'string'
        }
        return false
      })
      // If there's no docstring and pass is the only statement, it's needed
      if (!hasDocstring && siblings.length <= 1) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary pass statement',
      '`pass` in a block that already has other statements is redundant.',
      sourceCode,
      'Remove the redundant `pass` statement.',
    )
  },
}
