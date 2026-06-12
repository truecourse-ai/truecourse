import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { unwrapParens } from './_helpers.js'

/**
 * `if (true)` / `if (false)` / `while (false)` — a literal condition makes
 * the branch dead code or unconditional. `while (true)` is the idiomatic
 * intentional-infinite-loop form and is skipped, as is `do … while (false)`
 * (a break-out scope idiom).
 */
export const csharpConstantConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/constant-condition',
  languages: ['csharp'],
  nodeTypes: ['if_statement', 'while_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    const inner = unwrapParens(condition)
    if (inner.type !== 'boolean_literal') return null
    if (node.type === 'while_statement' && inner.text === 'true') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Constant condition',
      `Condition is always \`${inner.text}\` — this ${node.type === 'if_statement' ? 'branch' : 'loop'} is ${inner.text === 'false' ? 'dead code' : 'always taken'}.`,
      sourceCode,
      'Remove the condition or fix the logic.',
    )
  },
}
