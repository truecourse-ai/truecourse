import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsideLoop } from './_helpers.js'
import { detectUiFramework } from '../../../_shared/framework-detection.js'

const REACT_STATE_SETTERS = /^set[A-Z]/

export const stateUpdateInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/state-update-in-loop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let funcName = ''
    if (fn.type === 'identifier') {
      funcName = fn.text
    }

    // Must match React setter naming convention: setFoo(...)
    if (!REACT_STATE_SETTERS.test(funcName)) return null

    // Gate by React import — pre-fix the rule fired on any OOP class with
    // setter methods (`setName`, `setTitle`) on non-React projects.
    if (detectUiFramework(node) !== 'react') return null

    if (!isInsideLoop(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'React state update in loop',
      `Calling ${funcName}() inside a loop triggers multiple re-renders. Batch updates or compute the final state first.`,
      sourceCode,
      'Compute the final state outside the loop, then call the setter once.',
    )
  },
}
