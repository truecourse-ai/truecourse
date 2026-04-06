import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonImplicitStringConcatVisitor: CodeRuleVisitor = {
  ruleKey: 'style/deterministic/implicit-string-concatenation',
  languages: ['python'],
  nodeTypes: ['concatenated_string'],
  visit(node, filePath, sourceCode) {
    // Python's implicit string concatenation: "hello" "world"
    // Only flag if on the same line (multi-line is intentional)
    if (node.startPosition.row === node.endPosition.row) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Implicit string concatenation',
        'Adjacent string literals are implicitly concatenated. This may be unintentional (missing comma in list?).',
        sourceCode,
        'Use explicit + operator or add a comma if this is a list/tuple element.',
      )
    }

    return null
  },
}
