import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'

/**
 * Detects references to undefined names in Python code.
 * Uses the DataFlowContext's undeclaredReferences() which already
 * tracks scope, imports, and builtins.
 *
 * Heuristic-based: works without a type checker by relying on
 * AST-level scope analysis from the data-flow engine.
 */
export const pythonUndefinedNameVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/undefined-name',
  languages: ['python'],
  nodeTypes: ['module'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    if (!dataFlow) return null

    const undeclared = dataFlow.undeclaredReferences()
    for (const ref of undeclared) {
      const parent = ref.node.parent
      if (!parent) continue

      // Skip assignment left-hand side — these define the name
      const isAssignmentLeft =
        (parent.type === 'assignment' || parent.type === 'augmented_assignment') &&
        parent.childForFieldName('left') === ref.node
      if (isAssignmentLeft) continue

      // Skip names used as type annotations (often forward refs or typing constructs)
      if (isTypeAnnotationContext(ref.node)) continue

      // Skip decorator names — may be from unresolved imports
      if (parent.type === 'decorator') continue

      // Skip `__all__`, `__name__`, `__file__` etc. — module-level dunder attrs
      if (/^__\w+__$/.test(ref.name)) continue

      return makeViolation(
        this.ruleKey,
        ref.node,
        filePath,
        'critical',
        'Undefined name',
        `\`${ref.name}\` is not defined. This will raise a \`NameError\` at runtime.`,
        sourceCode,
        'Define the variable, import it, or check for typos.',
      )
    }
    return null
  },
}

function isTypeAnnotationContext(node: import('tree-sitter').SyntaxNode): boolean {
  let current = node.parent
  while (current) {
    if (current.type === 'type') return true
    if (current.type === 'annotation' || current.type === 'return_type') return true
    // String annotations used as forward references
    if (current.type === 'string' && current.parent?.type === 'type') return true
    current = current.parent
  }
  return false
}
