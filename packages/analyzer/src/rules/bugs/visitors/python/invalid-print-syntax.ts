import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detects: print >> sys.stderr, "message" (Python 2 syntax invalid in Python 3)
// tree-sitter-python parses standalone form as print_statement with chevron,
// and expression-context form (e.g. x = print >> ...) as binary_operator with >> operator.
export const pythonInvalidPrintSyntaxVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-print-syntax',
  languages: ['python'],
  nodeTypes: ['print_statement', 'binary_operator'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'print_statement') {
      // Check for chevron child (>> redirect syntax)
      const hasChevron = node.namedChildren.some((c) => c.type === 'chevron')
      if (!hasChevron) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Invalid print syntax',
        '`print >> sys.stderr, ...` is invalid Python 3 syntax — this is Python 2\'s chevron print statement.',
        sourceCode,
        'Use `print(..., file=sys.stderr)` instead.',
      )
    }

    if (node.type === 'binary_operator') {
      // In expression context: print >> sys.stderr
      const op = node.children.find(c => !c.isNamed)
      if (!op || op.text !== '>>') return null

      const left = node.childForFieldName('left')
      if (!left || left.type !== 'identifier' || left.text !== 'print') return null

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
