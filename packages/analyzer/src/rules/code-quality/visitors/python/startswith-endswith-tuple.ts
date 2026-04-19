import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

function isStartsEndsWith(node: SyntaxNode): boolean {
  if (node.type !== 'call') return false
  const fn = node.childForFieldName('function')
  if (!fn || fn.type !== 'attribute') return false
  const attr = fn.childForFieldName('attribute')
  return attr?.text === 'startswith' || attr?.text === 'endswith'
}

function collectOrOperands(node: SyntaxNode): SyntaxNode[] {
  if (node.type === 'boolean_operator') {
    const op = node.children.find((c) => c.type === 'or' || c.text === 'or')
    if (op) {
      const left = node.namedChildren[0]
      const right = node.namedChildren[1]
      if (left && right) {
        return [...collectOrOperands(left), ...collectOrOperands(right)]
      }
    }
  }
  return [node]
}

export const pythonStartswithEndswithTupleVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/startswith-endswith-tuple',
  languages: ['python'],
  nodeTypes: ['boolean_operator'],
  visit(node, filePath, sourceCode) {
    // Only check top-level boolean_operator (avoid re-flagging sub-expressions)
    if (node.parent?.type === 'boolean_operator') return null

    // Check if operator is 'or'
    const hasOr = node.children.some((c) => c.type === 'or' || c.text === 'or')
    if (!hasOr) return null

    const operands = collectOrOperands(node)
    if (operands.length < 2) return null

    const startswithCalls = operands.filter(isStartsEndsWith)
    if (startswithCalls.length < 2) return null

    // Check they're called on the same object
    const firstObj = (startswithCalls[0].childForFieldName('function') as SyntaxNode | null)?.childForFieldName('object')?.text
    const allSameObj = startswithCalls.every(
      (c) => (c.childForFieldName('function') as SyntaxNode | null)?.childForFieldName('object')?.text === firstObj,
    )
    if (!allSameObj) return null

    const method = (startswithCalls[0].childForFieldName('function') as SyntaxNode | null)?.childForFieldName('attribute')?.text ?? 'startswith'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Multiple ${method}() calls combinable with tuple`,
      `Multiple \`${method}()\` calls on the same object joined by \`or\` can be combined into a single call with a tuple of prefixes.`,
      sourceCode,
      `Replace \`s.${method}("a") or s.${method}("b")\` with \`s.${method}(("a", "b"))\`.`,
    )
  },
}
