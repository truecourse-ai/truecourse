import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonEmptyTypeCheckingBlockVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/empty-type-checking-block',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // if TYPE_CHECKING: <empty or only pass>
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    const condText = condition.text.trim()
    if (condText !== 'TYPE_CHECKING') return null

    const consequence = node.childForFieldName('consequence')
    if (!consequence) return null

    const stmts = consequence.namedChildren
    if (stmts.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Empty TYPE_CHECKING block',
        '`if TYPE_CHECKING:` block has no imports — this is dead code.',
        sourceCode,
        'Remove the empty `if TYPE_CHECKING:` block.',
      )
    }
    if (stmts.length === 1 && stmts[0].type === 'pass_statement') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Empty TYPE_CHECKING block',
        '`if TYPE_CHECKING:` block contains only `pass` — this is dead code.',
        sourceCode,
        'Remove the empty `if TYPE_CHECKING:` block.',
      )
    }
    return null
  },
}
