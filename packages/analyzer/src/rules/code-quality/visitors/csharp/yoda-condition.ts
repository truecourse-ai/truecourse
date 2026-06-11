import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const COMPARISON_OPS = new Set(['==', '!=', '<', '>', '<=', '>='])
const LITERAL_TYPES = new Set([
  'integer_literal', 'real_literal', 'string_literal', 'verbatim_string_literal',
  'character_literal', 'boolean_literal', 'null_literal',
])

function isConstantOperand(node: SyntaxNode): boolean {
  if (LITERAL_TYPES.has(node.type)) return true
  // SCREAMING_CASE constant identifiers.
  if (node.type === 'identifier' && /^[A-Z_][A-Z0-9_]+$/.test(node.text)) return true
  return false
}

export const csharpYodaConditionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/yoda-condition',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text ?? ''
    if (!COMPARISON_OPS.has(op)) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    if (isConstantOperand(left) && !isConstantOperand(right)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Yoda condition',
        `Constant \`${left.text}\` is on the left side — write \`${right.text} ${op} ${left.text}\` instead.`,
        sourceCode,
        'Move the variable to the left side of the comparison for better readability.',
      )
    }
    return null
  },
}
