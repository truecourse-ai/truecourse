import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'

/**
 * Detects references to variables that were never declared anywhere in scope.
 * Uses undeclaredReferences() which already filters out known globals.
 * Filters out assignment contexts (those are handled by implicit-global rule).
 */
export const noUndefVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/no-undef',
  // Only applies to JavaScript — in TypeScript the compiler handles undeclared references
  // via ambient declarations and tsconfig, so static detection here would be too noisy.
  languages: ['javascript'],
  nodeTypes: ['program'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    if (!dataFlow) return null
    const undeclared = dataFlow.undeclaredReferences()
    for (const ref of undeclared) {
      const parent = ref.node.parent
      if (!parent) continue

      // Skip assignment left-hand side (handled by implicit-global)
      const isAssignmentLeft =
        (parent.type === 'assignment_expression' || parent.type === 'augmented_assignment_expression') &&
        parent.childForFieldName('left')?.id === ref.node.id
      if (isAssignmentLeft) continue

      // Skip type positions (TypeScript type-only references)
      if (isTypePosition(ref.node)) continue

      return makeViolation(
        this.ruleKey,
        ref.node,
        filePath,
        'high',
        'Undeclared variable',
        `\`${ref.name}\` is not defined. This will throw a ReferenceError at runtime.`,
        sourceCode,
        'Declare the variable, import it, or add it to the global declarations if it is a runtime global.',
      )
    }
    return null
  },
}

function isTypePosition(node: import('web-tree-sitter').Node): boolean {
  let current = node.parent
  while (current) {
    if (
      current.type === 'type_annotation' ||
      current.type === 'type_alias_declaration' ||
      current.type === 'interface_declaration' ||
      current.type === 'type_parameter' ||
      current.type === 'type_arguments' ||
      current.type === 'generic_type' ||
      current.type === 'constraint' ||
      current.type === 'implements_clause' ||
      current.type === 'extends_clause' ||
      current.type === 'predefined_type'
    ) return true
    current = current.parent
  }
  return false
}
