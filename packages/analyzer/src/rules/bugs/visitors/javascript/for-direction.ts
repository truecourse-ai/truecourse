import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const forDirectionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/for-direction',
  languages: JS_LANGUAGES,
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const condition = node.childForFieldName('condition')
    const increment = node.childForFieldName('increment')

    if (!condition || !increment) return null

    // Parse condition: i < 10, i <= 10, i > 0, i >= 0
    let condOp: string | null = null
    if (condition.type === 'binary_expression') {
      const op = condition.children.find((c) => ['<', '<=', '>', '>='].includes(c.text))
      if (op) condOp = op.text
    }
    if (!condOp) return null

    // Parse increment: i++, i--, i+=1, i-=1, ++i, --i
    let direction: 'up' | 'down' | null = null
    if (increment.type === 'update_expression') {
      const op = increment.children.find((c) => c.text === '++' || c.text === '--')
      if (op) direction = op.text === '++' ? 'up' : 'down'
    } else if (increment.type === 'assignment_expression' || increment.type === 'augmented_assignment_expression') {
      const op = increment.children.find((c) => c.text === '+=' || c.text === '-=')
      if (op) direction = op.text === '+=' ? 'up' : 'down'
    }
    if (!direction) return null

    // Wrong direction: counting up but condition expects going down, or vice versa
    const isWrong =
      (direction === 'down' && (condOp === '<' || condOp === '<=')) ||
      (direction === 'up' && (condOp === '>' || condOp === '>='))

    if (isWrong) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Wrong loop direction',
        `Loop counter goes ${direction} but condition uses \`${condOp}\` — this will either loop infinitely or never execute.`,
        sourceCode,
        `Fix the loop: change the increment direction or the comparison operator.`,
      )
    }
    return null
  },
}
