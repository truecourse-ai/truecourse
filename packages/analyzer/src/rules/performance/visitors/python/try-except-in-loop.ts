import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsidePythonLoop } from './_helpers.js'

export const tryExceptInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/try-except-in-loop',
  languages: ['python'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    if (!isInsidePythonLoop(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'try/except inside loop',
      'try/except inside a loop adds overhead per iteration. Move the try/except outside the loop if possible.',
      sourceCode,
      'Wrap the entire loop in a try/except, or use a conditional check instead of exception handling.',
    )
  },
}
