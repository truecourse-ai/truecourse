import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects incorrect sys.version_info or sys.platform comparisons in .pyi stub
 * files. In stubs, version checks should use `>=` not `>`, and platform checks
 * should compare to known platform strings.
 */
export const pythonTypeStubVersionCheckErrorVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/type-stub-version-check-error',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    if (!filePath.endsWith('.pyi')) return null

    const text = node.text

    // Check for sys.version_info comparisons
    if (text.includes('sys.version_info')) {
      // PYI003: In stubs, version comparisons should use >= or < (not > or <=)
      // Because stub files define what's available at a specific version boundary
      if (text.includes('sys.version_info >') && !text.includes('>=')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Type stub version check error',
          'In .pyi stubs, use `sys.version_info >= (x, y)` instead of `>`. Stub version checks should use `>=` or `<` operators.',
          sourceCode,
          'Replace `>` with `>=` in the version check.',
        )
      }
      if (text.includes('sys.version_info <=') || text.includes('sys.version_info<=')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Type stub version check error',
          'In .pyi stubs, use `sys.version_info < (x, y)` instead of `<=`. Stub version checks should use `>=` or `<` operators.',
          sourceCode,
          'Replace `<=` with `<` in the version check.',
        )
      }
    }

    // Check for sys.platform comparisons using != (PYI008)
    if (text.includes('sys.platform')) {
      if (text.includes('!=')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Type stub platform check error',
          'In .pyi stubs, use `==` for `sys.platform` checks, not `!=`. Use `else` branches for other platforms.',
          sourceCode,
          'Replace `sys.platform != ...` with `sys.platform == ...` and use an else branch.',
        )
      }
    }

    return null
  },
}
