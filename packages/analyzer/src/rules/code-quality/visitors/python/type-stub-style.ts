import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects style issues in .pyi stub files:
 * - PYI009: `pass` in empty body (should use `...` / Ellipsis instead)
 * - PYI010: Function body with non-ellipsis content (stubs should only have `...`)
 * - PYI012: Class body with `pass` (should use `...`)
 * - PYI014/PYI015: Complex default values (should use `...`)
 */
export const pythonTypeStubStyleVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/type-stub-style',
  languages: ['python'],
  nodeTypes: ['function_definition', 'class_definition'],
  visit(node, filePath, sourceCode) {
    if (!filePath.endsWith('.pyi')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    if (node.type === 'function_definition') {
      // PYI009/PYI010: Function body should be `...` only in stubs
      for (let i = 0; i < body.namedChildCount; i++) {
        const child = body.namedChild(i)
        if (!child) continue

        // Check for `pass` statement (should be `...`)
        if (child.type === 'pass_statement') {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Type stub style',
            'Use `...` (Ellipsis) instead of `pass` in .pyi stub function bodies.',
            sourceCode,
            'Replace `pass` with `...`.',
          )
        }

        // Check for non-trivial body (not just `...` or docstring + `...`)
        if (child.type === 'expression_statement') {
          const expr = child.namedChildren[0]
          if (expr && expr.type !== 'ellipsis' && expr.type !== 'string') {
            return makeViolation(
              this.ruleKey, node, filePath, 'low',
              'Type stub style',
              'Function body in .pyi stubs should only contain `...` (Ellipsis), not implementation code.',
              sourceCode,
              'Replace the function body with `...`.',
            )
          }
        }

        // If it's a return statement with a value, flag it
        if (child.type === 'return_statement' && child.namedChildCount > 0) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Type stub style',
            'Function body in .pyi stubs should only contain `...` (Ellipsis), not return statements.',
            sourceCode,
            'Replace the function body with `...`.',
          )
        }
      }
    }

    if (node.type === 'class_definition') {
      // PYI012: Class body with `pass` should use `...`
      for (let i = 0; i < body.namedChildCount; i++) {
        const child = body.namedChild(i)
        if (!child) continue

        if (child.type === 'pass_statement') {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Type stub style',
            'Use `...` (Ellipsis) instead of `pass` in .pyi stub class bodies.',
            sourceCode,
            'Replace `pass` with `...`.',
          )
        }
      }
    }

    return null
  },
}
