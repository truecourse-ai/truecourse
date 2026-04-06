import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonComparisonToNoneConstantVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/comparison-to-none-constant',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    const children = node.children

    // Look for `is` or `is not` operator
    const hasIs = children.some((c) => c.text === 'is' || c.text === 'is not')
    if (!hasIs) return null

    // Check if one side is a new object construction and the other is None
    const namedChildren = node.namedChildren
    if (namedChildren.length !== 2) return null

    const [left, right] = namedChildren
    const leftIsNone = left.type === 'none'
    const rightIsNone = right.type === 'none'

    if (!leftIsNone && !rightIsNone) return null

    const other = leftIsNone ? right : left
    // New object: a call expression that creates a new instance (constructor call)
    if (other.type === 'call') {
      const fn = other.childForFieldName('function')
      // Heuristic: capitalized function name suggests a class constructor
      if (fn && fn.text.charAt(0) === fn.text.charAt(0).toUpperCase() && fn.text.charAt(0) !== fn.text.charAt(0).toLowerCase()) {
        const opText = children.find((c) => c.text === 'is' || c.text === 'is not')?.text ?? 'is'
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Comparison to None is always constant',
          `\`${node.text}\` — a newly created object \`${other.text}\` is never \`None\`, so this \`${opText}\` check always evaluates to \`${opText === 'is' ? 'False' : 'True'}\`.`,
          sourceCode,
          'Remove the redundant None check, or check if the variable that holds the object could be None.',
        )
      }
    }
    return null
  },
}
