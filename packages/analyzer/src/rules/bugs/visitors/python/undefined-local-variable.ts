import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'

/**
 * Detects local variables referenced before being assigned in their scope.
 * Uses the DataFlowContext's usedBeforeDefined() analysis.
 *
 * Example:
 *   def foo():
 *       print(x)   # NameError — x not yet assigned
 *       x = 10
 */
export const pythonUndefinedLocalVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/undefined-local-variable',
  languages: ['python'],
  nodeTypes: ['module'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    if (!dataFlow) return null

    const usedBeforeDef = dataFlow.usedBeforeDefined()
    for (const variable of usedBeforeDef) {
      // Only report for local variables (not module-level, where order matters less)
      if (variable.scope.kind !== 'function') continue

      // Skip variables that are parameters — they're always defined
      if (variable.kind === 'parameter') continue

      const firstUse = variable.useSites[0]
      if (!firstUse) continue

      return makeViolation(
        this.ruleKey,
        firstUse.node,
        filePath,
        'critical',
        'Variable used before assignment',
        `\`${variable.name}\` is used before being assigned in this scope — \`NameError\` at runtime.`,
        sourceCode,
        `Assign \`${variable.name}\` before using it, or check that all code paths define it.`,
      )
    }
    return null
  },
}
