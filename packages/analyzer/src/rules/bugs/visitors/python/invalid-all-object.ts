import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonInvalidAllObjectVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-all-object',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left || left.text !== '__all__') return null

    const right = node.childForFieldName('right')
    if (!right || right.type !== 'list') return null

    for (const item of right.namedChildren) {
      if (item.type !== 'string') {
        return makeViolation(
          this.ruleKey, item, filePath, 'high',
          'Non-string in __all__',
          `\`__all__\` contains a non-string value \`${item.text}\` (${item.type}) — this will cause a TypeError when importing with \`*\`.`,
          sourceCode,
          'All entries in `__all__` must be string literals.',
        )
      }
    }
    return null
  },
}
