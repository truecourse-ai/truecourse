import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * `x = x;` / `this.Items = this.Items;` — assigning an expression to itself
 * has no effect; usually a missed rename (`this.name = name` typo'd as
 * `name = name`).
 */
export const csharpSelfAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/self-assignment',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const operator = node.childForFieldName('operator')
    if (!left || !right || operator?.text !== '=') return null

    if (left.text !== right.text || left.type !== right.type) return null
    if (left.text.includes('(')) return null // indexer/call results may differ

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Self assignment',
      `Assigning \`${left.text}\` to itself has no effect.`,
      sourceCode,
      'Assign a different value (e.g. `this.field = parameter`) or remove this statement.',
    )
  },
}
