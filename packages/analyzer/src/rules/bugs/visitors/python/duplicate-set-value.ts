import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDuplicateSetValueVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/duplicate-set-value',
  languages: ['python'],
  nodeTypes: ['set'],
  visit(node, filePath, sourceCode) {
    const seen = new Set<string>()
    for (const child of node.namedChildren) {
      const val = child.text
      if (seen.has(val)) {
        return makeViolation(
          this.ruleKey, child, filePath, 'medium',
          'Duplicate set value',
          `Value \`${val}\` appears more than once in the set literal — the duplicate is silently ignored.`,
          sourceCode,
          'Remove the duplicate value from the set literal.',
        )
      }
      seen.add(val)
    }
    return null
  },
}
