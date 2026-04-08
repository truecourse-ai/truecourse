import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { findContainingStatement } from './_helpers.js'

export const uncheckedArrayAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/unchecked-array-access',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['subscript_expression'],
  visit(node, filePath, sourceCode) {
    const object = node.childForFieldName('object')
    const index = node.childForFieldName('index')
    if (!object || !index) return null

    // Only flag dynamic index access (variables), not literal indexes like arr[0]
    if (index.type === 'number') return null
    // Skip string indexes (object property access)
    if (index.type === 'string') return null
    // Skip when index is cast to string (property key access, not array indexing)
    if (index.type === 'as_expression' && /\bas\s+string\b/.test(index.text)) return null
    // Skip when object is a Record/Map type assertion (property access, not array)
    if (object.type === 'parenthesized_expression' && object.text.includes('Record<')) return null
    if (object.type === 'as_expression' && object.text.includes('Record<')) return null

    // Skip if the index is a well-known safe pattern like .length - 1
    const indexText = index.text
    if (indexText.includes('.length')) return null

    // Check if there is a bounds check nearby (same block)
    const statement = findContainingStatement(node)
    if (!statement || !statement.parent) return null

    const siblings = statement.parent.namedChildren
    const stmtIndex = siblings.indexOf(statement)

    // Look at preceding statements for a bounds check
    for (let i = Math.max(0, stmtIndex - 3); i < stmtIndex; i++) {
      const sibText = siblings[i].text
      if (sibText.includes('.length') && (sibText.includes(indexText) || sibText.includes('if'))) {
        return null
      }
    }

    // Check if the parent is an if condition checking bounds
    let parent: SyntaxNode | null = node.parent
    while (parent) {
      if (parent.type === 'if_statement') {
        const condition = parent.childForFieldName('condition')
        if (condition && condition.text.includes('.length')) return null
      }
      if (parent.type === 'ternary_expression' || parent.type === 'binary_expression') {
        if (parent.text.includes('.length')) return null
      }
      parent = parent.parent
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Unchecked array index access',
      `Array access ${object.text}[${indexText}] without a bounds check may return undefined.`,
      sourceCode,
      'Add a bounds check (e.g., if (i < arr.length)) before accessing the array by index.',
    )
  },
}
