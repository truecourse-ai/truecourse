import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detects: x! ?? y — non-null assertion before nullish coalescing
// The non-null assertion says x is never null/undefined, but ?? only triggers for null/undefined
// The ?? fallback can never be reached, making it contradictory
export const contradictoryNonNullCoalescingVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/contradictory-non-null-coalescing',
  languages: JS_LANGUAGES,
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')
    if (!op || op.text !== '??') return null

    const left = node.childForFieldName('left')
    if (!left) return null

    // Check if left side is a non-null assertion (x!)
    if (left.type === 'non_null_expression') {
      const inner = left.namedChildren[0]
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Non-null assertion contradicts nullish coalescing',
        `\`${left.text} ?? ...\` — the non-null assertion \`!\` asserts that \`${inner?.text ?? 'value'}\` is never null/undefined, making the \`??\` fallback unreachable.`,
        sourceCode,
        'Remove either the `!` non-null assertion or the `??` fallback — they are contradictory.',
      )
    }

    return null
  },
}
