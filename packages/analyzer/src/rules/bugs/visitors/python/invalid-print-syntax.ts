import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: print >> sys.stderr, "message" (Python 2 syntax invalid in Python 3)
// In Python 3's tree-sitter grammar this parses as a binary expression with >> operator
// The pattern: expression_statement containing binary_operator where left is 'print' identifier
// and operator is '>>'
export const pythonInvalidPrintSyntaxVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-print-syntax',
  languages: ['python'],
  nodeTypes: ['binary_operator'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')
    if (!op || op.text !== '>>') return null

    const left = node.childForFieldName('left')
    if (!left) return null

    // Check if left side is 'print' identifier
    if (left.type === 'identifier' && left.text === 'print') {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Invalid print syntax',
        '`print >> sys.stderr, ...` is invalid Python 3 syntax — this is Python 2\'s chevron print statement.',
        sourceCode,
        'Use `print(..., file=sys.stderr)` instead.',
      )
    }

    return null
  },
}
