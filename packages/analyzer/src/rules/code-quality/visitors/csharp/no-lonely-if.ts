import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { csharpLonelyIfInElse } from './collapsible-else-if.js'

export const csharpNoLonelyIfVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/no-lonely-if',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const lonely = csharpLonelyIfInElse(node)
    if (!lonely) return null

    return makeViolation(
      this.ruleKey, lonely, filePath, 'low',
      'Lonely if in else block',
      '`if` is the only statement inside `else { }`. Use `else if` instead.',
      sourceCode,
      'Replace `else { if (…) }` with `else if (…)`.',
    )
  },
}
