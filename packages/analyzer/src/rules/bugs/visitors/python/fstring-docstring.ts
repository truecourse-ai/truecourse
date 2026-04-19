import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonFstringDocstringVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fstring-docstring',
  languages: ['python'],
  nodeTypes: ['function_definition', 'class_definition', 'module'],
  visit(node, filePath, sourceCode) {
    let body: import('web-tree-sitter').Node | null = null
    if (node.type === 'module') {
      body = node
    } else {
      body = node.childForFieldName('body')
    }
    if (!body) return null

    // Get the first non-comment statement
    const firstStmt = body.namedChildren.find((c) => c.type !== 'comment')
    if (!firstStmt) return null

    // Check if it's an expression_statement containing an f-string
    if (firstStmt.type !== 'expression_statement') return null

    const expr = firstStmt.namedChildren[0]
    if (!expr) return null

    // f-string in tree-sitter is of type 'string' but starts with f" or f'
    if (expr.type === 'string' && (expr.text.startsWith('f"') || expr.text.startsWith("f'") ||
        expr.text.startsWith('f"""') || expr.text.startsWith("f'''"))) {
      return makeViolation(
        this.ruleKey, expr, filePath, 'medium',
        'f-string used as docstring',
        'An f-string cannot serve as a docstring — `__doc__` will be `None`. Use a plain string literal for the docstring.',
        sourceCode,
        'Change the f-string to a plain string literal (remove the `f` prefix).',
      )
    }
    return null
  },
}
