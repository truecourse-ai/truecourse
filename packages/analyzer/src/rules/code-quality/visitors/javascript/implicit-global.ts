import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'

/**
 * Detects assignments to undeclared variables that create implicit globals.
 * Uses undeclaredReferences() filtered to identifier nodes that appear on the
 * left side of an assignment expression at the module/function scope.
 */
export const implicitGlobalVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/implicit-global',
  languages: ['javascript'],
  nodeTypes: ['program'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    if (!dataFlow) return null
    const undeclared = dataFlow.undeclaredReferences()
    for (const ref of undeclared) {
      const parent = ref.node.parent
      if (!parent) continue
      // Must be on the left side of an assignment (not in augmented assignment which would throw anyway)
      const isAssignmentLeft =
        (parent.type === 'assignment_expression' || parent.type === 'augmented_assignment_expression') &&
        parent.childForFieldName('left') === ref.node
      if (!isAssignmentLeft) continue

      return makeViolation(
        this.ruleKey,
        ref.node,
        filePath,
        'high',
        'Implicit global variable',
        `Assignment to undeclared variable \`${ref.name}\` creates an implicit global. Add \`let\`, \`const\`, or \`var\`.`,
        sourceCode,
        'Declare the variable with let, const, or var to avoid creating an implicit global.',
      )
    }
    return null
  },
}
