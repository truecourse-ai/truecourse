import type { Node as SyntaxNode } from 'web-tree-sitter'
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

    // Skip when index is a member expression (obj.prop) — typically Record/Map lookups, not array indexing
    if (index.type === 'member_expression') return null

    // Skip when result is accessed with optional chaining (obj[key]?.prop) — already null-safe
    if (node.parent && (node.parent.text.startsWith(node.text + '?.') || node.text.includes('?.'))) return null

    // Skip array writes (assignment targets) — writing to an index can't crash
    if (node.parent?.type === 'assignment_expression' && node.parent.childForFieldName('left')?.id === node.id) return null

    // Skip when the result is used with a fallback (|| default, ?? default)
    if (node.parent?.type === 'binary_expression' && /\|\||&&|\?\?/.test(node.parent.text.slice(node.text.length))) return null

    // Check if there is a bounds check nearby (same block)
    const statement = findContainingStatement(node)
    if (!statement || !statement.parent) return null

    const siblings = statement.parent.namedChildren
    const stmtIndex = siblings.findIndex(n => n.id === statement.id)

    // Look at preceding AND following statements for a guard
    for (let i = Math.max(0, stmtIndex - 3); i <= Math.min(siblings.length - 1, stmtIndex + 2); i++) {
      const sibText = siblings[i].text
      if (sibText.includes('.length') && (sibText.includes(indexText) || sibText.includes('if'))) {
        return null
      }
      // Check for `key in obj` pattern (property existence check)
      if (sibText.includes(' in ') && sibText.includes(indexText)) {
        return null
      }
      // Check for guards that reference the index variable: if (!result), if (x >= N) return, etc.
      if (sibText.includes('if') && sibText.includes(indexText)) {
        return null
      }
    }

    // Check if inside a for loop that bounds the index variable to array length
    let ancestor: SyntaxNode | null = node.parent
    while (ancestor) {
      if (ancestor.type === 'for_statement' || ancestor.type === 'while_statement') {
        const condition = ancestor.childForFieldName('condition')
        if (condition && condition.text.includes('.length')) {
          // Match exact index or base variable (e.g., `i` for index `i + 1`)
          const baseVar = indexText.replace(/\s*[+\-]\s*\d+$/, '')
          if (condition.text.includes(indexText) || condition.text.includes(baseVar)) return null
        }
      }
      if (ancestor.type === 'function_declaration' || ancestor.type === 'arrow_function' ||
          ancestor.type === 'function_expression' || ancestor.type === 'method_definition') break
      ancestor = ancestor.parent
    }

    // Check if the parent is an if condition checking bounds
    let parent: SyntaxNode | null = node.parent
    while (parent) {
      if (parent.type === 'if_statement') {
        const condition = parent.childForFieldName('condition')
        if (condition && condition.text.includes('.length')) return null
        if (condition && condition.text.includes(' in ') && condition.text.includes(indexText)) return null
      }
      if (parent.type === 'ternary_expression' || parent.type === 'binary_expression') {
        if (parent.text.includes('.length')) return null
        if (parent.text.includes(' in ') && parent.text.includes(indexText)) return null
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
