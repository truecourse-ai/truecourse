import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function isInsideTryExcept(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'try_statement') return true
    current = current.parent
  }
  return false
}

export const pythonUnsafeJsonParseVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/unsafe-json-parse',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null

    const obj = fn.childForFieldName('object')
    const attr = fn.childForFieldName('attribute')
    if (obj?.text !== 'json' || (attr?.text !== 'loads' && attr?.text !== 'load')) return null

    if (isInsideTryExcept(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unsafe json.loads/json.load',
      `json.${attr!.text}() can raise on malformed input. Wrap it in a try/except.`,
      sourceCode,
      `Wrap json.${attr!.text}() in a try/except to handle JSONDecodeError gracefully.`,
    )
  },
}
