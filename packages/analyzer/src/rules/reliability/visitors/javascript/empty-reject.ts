import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsidePromiseConstructor } from './_helpers.js'

export const emptyRejectVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/empty-reject',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    // Promise.reject() or reject()
    let isReject = false
    if (fn.type === 'member_expression') {
      const obj = fn.childForFieldName('object')
      const prop = fn.childForFieldName('property')
      if (obj?.text === 'Promise' && prop?.text === 'reject') isReject = true
    } else if (fn.type === 'identifier' && fn.text === 'reject') {
      // Inside a new Promise((resolve, reject) => ...) — check if in promise constructor context
      isReject = isInsidePromiseConstructor(node)
    }

    if (!isReject) return null

    const args = node.childForFieldName('arguments')
    if (!args || args.namedChildren.length === 0) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Empty Promise.reject()',
        'Promise.reject() called without an error argument. Rejections should include an Error for debugging.',
        sourceCode,
        'Pass an Error object: Promise.reject(new Error("description")).',
      )
    }

    return null
  },
}
