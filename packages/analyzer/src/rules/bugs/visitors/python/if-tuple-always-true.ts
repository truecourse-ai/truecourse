import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: if (condition,): — tuple is always truthy
// This is usually a mistake where someone put a comma after the condition
export const pythonIfTupleAlwaysTrueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/if-tuple-always-true',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    if (!condition) return null

    if (condition.type === 'tuple') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Non-empty tuple as if condition',
        `\`if ${condition.text}:\` is always \`True\` because a non-empty tuple is truthy — likely a mistake (stray comma or missing condition).`,
        sourceCode,
        'Remove the trailing comma or parentheses that create a tuple: use `if condition:` instead of `if condition,:` or `if (condition,):`.',
      )
    }

    return null
  },
}
