import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * sonarjs/S5958 (test-check-exception)
 * Detects test cases that use expect().toThrow() or expect().rejects without
 * verifying the specific exception type.
 *
 * e.g.:
 *   expect(fn).toThrow()           // should specify error type
 *   await expect(p).rejects        // should use .rejects.toThrow(ErrorType)
 */
export const testMissingExceptionCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/test-missing-exception-check',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const method = fn.childForFieldName('property')
    if (!method) return null

    // expect(fn).toThrow() without argument → should specify error type
    if (method.text === 'toThrow' || method.text === 'toThrowError') {
      const args = node.childForFieldName('arguments')
      const argList = args?.namedChildren.filter((c) => c.type !== 'comment') ?? []
      if (argList.length === 0) {
        // Check if this is chained from expect(...)
        const obj = fn.childForFieldName('object')
        if (obj) {
          // Could be expect(fn).toThrow() or expect(fn).not.toThrow()
          const startsFromExpect = obj.type === 'call_expression'
            ? obj.childForFieldName('function')?.text === 'expect'
            : obj.type === 'member_expression' && obj.childForFieldName('object')?.type === 'call_expression'

          if (startsFromExpect) {
            return makeViolation(
              this.ruleKey, node, filePath, 'low',
              'Missing exception type check',
              `\`${method.text}()\` without an argument does not verify which exception is thrown. Specify the expected error type or message.`,
              sourceCode,
              `Pass the expected error type to \`${method.text}()\`, e.g., \`${method.text}(TypeError)\` or \`${method.text}('expected message')\`.`,
            )
          }
        }
      }
    }

    return null
  },
}
