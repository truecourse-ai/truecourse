import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsideLoop } from './_helpers.js'

export const regexInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/regex-in-loop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['new_expression', 'regex'],
  visit(node, filePath, sourceCode) {
    // new RegExp(...) in loop
    if (node.type === 'new_expression') {
      const constructor = node.childForFieldName('constructor')
      if (constructor?.text !== 'RegExp') return null
    }

    if (!isInsideLoop(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Regex created inside loop',
      'Creating a RegExp inside a loop recompiles the pattern on every iteration. Move it outside the loop.',
      sourceCode,
      'Hoist the regex to a constant outside the loop.',
    )
  },
}
