import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const multilineBlockWithoutBracesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/multiline-block-without-braces',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement', 'for_statement', 'for_in_statement', 'for_of_statement', 'while_statement'],
  visit(node, filePath, sourceCode) {
    const fields = ['consequence', 'body']
    for (const field of fields) {
      const body = node.childForFieldName(field)
      if (!body) continue
      if (body.type === 'statement_block') continue
      // Single-line if statements are safe regardless of what follows
      if (node.startPosition.row === body.endPosition.row) continue
      const bodyEnd = body.endPosition.row
      const nextSibling = (() => {
        const parent = node.parent
        if (!parent) return null
        let found = false
        for (let i = 0; i < parent.childCount; i++) {
          const child = parent.child(i)
          if (!child) continue
          if (found) return child
          if (child.id === node.id) found = true
        }
        return null
      })()
      if (nextSibling && nextSibling.startPosition.row === bodyEnd + 1) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Block without braces',
          'Control flow statement without braces — the following indented statement is NOT inside the block. Always use braces.',
          sourceCode,
          'Add curly braces { } around the block body.',
        )
      }
    }
    return null
  },
}
