import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

function isPytestRaisesCall(node: SyntaxNode): boolean {
  if (node.type !== 'call') return false
  const fn = node.childForFieldName('function')
  if (!fn || fn.type !== 'attribute') return false
  const obj = fn.childForFieldName('object')
  const attr = fn.childForFieldName('attribute')
  return obj?.text === 'pytest' && attr?.text === 'raises'
}

function isPytestRaises(withItem: SyntaxNode): boolean {
  // with_item has a value (the context expression)
  const expr = withItem.namedChildren[0]
  if (!expr) return false
  return isPytestRaisesCall(expr)
}

export const pythonPytestRaisesMultipleStatementsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/pytest-raises-multiple-statements',
  languages: ['python'],
  nodeTypes: ['with_statement'],
  visit(node, filePath, sourceCode) {
    // Find with items — they are inside with_clause in tree-sitter python
    let hasPytestRaises = false
    for (const child of node.namedChildren) {
      if (child.type === 'with_clause') {
        for (const item of child.namedChildren) {
          if (item.type === 'with_item' && isPytestRaises(item)) {
            hasPytestRaises = true
          }
        }
      }
      // Also check direct with_item children
      if (child.type === 'with_item' && isPytestRaises(child)) {
        hasPytestRaises = true
      }
    }
    if (!hasPytestRaises) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Count meaningful statements (not just pass) — body children may be expression_statement
    const stmts = body.namedChildren.filter((s) => s.type !== 'pass_statement' && s.type !== 'comment')
    if (stmts.length <= 1) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'pytest.raises with multiple statements',
      'Multiple statements inside a `pytest.raises` block — only the last statement is checked for the exception. Earlier statements may mask the actual raise location.',
      sourceCode,
      'Move all setup code before the `with pytest.raises(...)` block. Keep only the single statement that is expected to raise.',
    )
  },
}
