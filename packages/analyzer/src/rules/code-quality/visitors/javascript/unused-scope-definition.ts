import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { DataFlowContext } from '../../../../data-flow/types.js'

/**
 * Detects local variables and local functions defined in a scope but never used.
 * Uses dataFlow.unusedVariables() which returns variables with no use sites.
 * Only reports non-module-scope definitions (local scope) to avoid false positives on exports.
 */
export const unusedScopeDefinitionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-scope-definition',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  needsDataFlow: true,
  visit(node, filePath, sourceCode, dataFlow?: DataFlowContext) {
    if (!dataFlow) return null
    const unused = dataFlow.unusedVariables()
    for (const v of unused) {
      // Only report local (non-module-scope) definitions
      if (v.scope.kind === 'module') continue
      // The scope analyzer hoists function declaration names into their own scope.
      // Detect this: the declaration node's parent IS the scope's node
      // (e.g., function foo() {} → 'foo' identifier's parent is the function_declaration
      // which is the same node the function scope was created for).
      // These are effectively top-level declarations; skip them.
      if (v.declarationNode.parent === v.scope.node) continue
      // Skip underscore-prefixed names (intentionally unused convention)
      if (v.name.startsWith('_')) continue
      // Skip parameters — handled by separate rule
      if (v.kind === 'parameter') continue
      // Skip imports — handled by bundler/TypeScript
      if (v.kind === 'import') continue
      // Check if the variable is used as a shorthand property identifier in an object literal
      let usedAsShorthand = false
      function checkShorthand(n: import('tree-sitter').SyntaxNode) {
        if (usedAsShorthand) return
        if (n.type === 'shorthand_property_identifier' || n.type === 'shorthand_property_identifier_pattern') {
          if (n.text === v.name) { usedAsShorthand = true; return }
        }
        for (let i = 0; i < n.childCount; i++) {
          const child = n.child(i)
          if (child) checkShorthand(child)
        }
      }
      checkShorthand(v.scope.node)
      if (usedAsShorthand) continue
      // Report: local variable or function defined but never used
      const typeLabel = v.kind === 'function' ? 'function' : v.kind === 'class' ? 'class' : 'variable'
      return makeViolation(
        this.ruleKey,
        v.declarationNode,
        filePath,
        'low',
        'Unused local definition',
        `Local ${typeLabel} \`${v.name}\` is defined but never used. Remove it or prefix with \`_\` to mark as intentionally unused.`,
        sourceCode,
        `Remove the unused ${typeLabel} or prefix its name with _ to indicate intentional non-use.`,
      )
    }
    return null
  },
}
