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

    // for-in/for-of loops iterate over bounded collections — push is safe
    if (loopNode.type === 'for_in_statement' || loopNode.type === 'for_of_statement') return null

    // for_statement loops iterate a bounded number of times — push is safe
    if (loopNode.type === 'for_statement') return null

    // while loops with regex.exec() iterate bounded matches — push is safe
    if (loopNode.type === 'while_statement') {
      const condition = loopNode.childForFieldName('condition')
      if (condition && /\.exec\s*\(/.test(condition.text)) return null

      // Advancing-iterator pattern: `while (advancing OP threshold)` where
      // the body reassigns the advancing variable. Typical shapes:
      //   while (date.toDate() <= now) { …; date = expr.next() }
      //   while (cursor < end) { …; cursor++ }
      // The strict ordering operators (`<`, `<=`, `>`, `>=`) signal a
      // threshold-bounded loop; equality / negation / Iterator-protocol
      // checks (`!done`, `=== null`) are intentionally not skipped — those
      // are unbounded unless the iterator itself promises termination.
      if (condition) {
        const condText = condition.text
        const hasOrdering = /(?:^|[^<>=!])(?:<=?|>=?)(?!=)/.test(condText)
        const body = loopNode.childForFieldName('body')
        if (hasOrdering && body) {
          const bodyText = body.text
          const ignoreIds = new Set([
            'true', 'false', 'null', 'undefined', 'this', 'new', 'typeof',
            'instanceof', 'in', 'of', 'Date', 'now', 'length', 'size',
            'count', 'Math', 'Number', 'String', 'Array',
          ])
          for (const m of condText.matchAll(/\b([a-zA-Z_$][\w$]*)\b/g)) {
            const id = m[1]
            if (ignoreIds.has(id)) continue
            const reassignRe = new RegExp(`\\b${id}\\s*(?:=(?!=)|\\+\\+|--)`)
            if (reassignRe.test(bodyText)) return null
          }
        }
      }
    }

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
