import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isInsideLoop, findEnclosingLoop } from './_helpers.js'

export const unboundedArrayGrowthVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/unbounded-array-growth',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (prop?.text !== 'push') return null

    if (!isInsideLoop(node)) return null

    // Check if there's a length/size check in the loop or a splice/shift nearby
    const loopNode = findEnclosingLoop(node)
    if (!loopNode) return null

    const loopText = loopNode.text
    if (loopText.includes('.length') && (loopText.includes('splice') || loopText.includes('shift') || loopText.includes('pop') || loopText.includes('slice'))) {
      return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Array.push() in loop without bounds',
      'Array.push() inside a loop without any bounds checking or pruning can lead to unbounded memory growth.',
      sourceCode,
      'Add a maximum size check or use a bounded data structure (e.g., ring buffer).',
    )
  },
}
