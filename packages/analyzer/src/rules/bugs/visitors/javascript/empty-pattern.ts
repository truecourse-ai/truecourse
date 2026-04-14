import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const emptyPatternVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/empty-pattern',
  languages: JS_LANGUAGES,
  nodeTypes: ['object_pattern', 'array_pattern'],
  visit(node, filePath, sourceCode) {
    // Flag if the pattern has no named children (no bindings)
    const bindings = node.namedChildren.filter((c) => c.type !== 'comment')
    if (bindings.length === 0) {
      const kind = node.type === 'object_pattern' ? '{}' : '[]'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Empty destructuring pattern',
        `Empty destructuring pattern \`${kind}\` does not bind any variables.`,
        sourceCode,
        'Add variable bindings to the destructuring pattern or remove it entirely.',
      )
    }
    return null
  },
}
