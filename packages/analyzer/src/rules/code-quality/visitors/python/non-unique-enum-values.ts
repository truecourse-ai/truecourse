import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

function isEnumClass(node: SyntaxNode): boolean {
  const bases = node.childForFieldName('superclasses')
  if (!bases) return false
  // Check if any superclass is Enum or IntEnum or other Enum subclass
  const baseText = bases.text
  return /\bEnum\b|\bIntEnum\b|\bStrEnum\b|\bFlag\b|\bIntFlag\b/.test(baseText)
}

export const pythonNonUniqueEnumValuesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/non-unique-enum-values',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    if (!isEnumClass(node)) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const seenValues = new Map<string, string>()

    for (const outerStmt of body.namedChildren) {
      const stmt = outerStmt.type === 'expression_statement' ? outerStmt.namedChildren[0] : outerStmt
      if (!stmt) continue
      if (stmt.type === 'assignment') {
        const left = stmt.childForFieldName('left')
        const right = stmt.childForFieldName('right')
        if (!left || !right) continue
        const name = left.text
        const value = right.text

        if (seenValues.has(value)) {
          const firstMember = seenValues.get(value)!
          return makeViolation(
            this.ruleKey, stmt, filePath, 'medium',
            'Duplicate enum value',
            `Enum member \`${name}\` has the same value as \`${firstMember}\`. Duplicate enum values create aliases which may cause unexpected behavior.`,
            sourceCode,
            'Give each enum member a unique value, or use `@unique` decorator to enforce uniqueness.',
          )
        }
        seenValues.set(value, name)
      }
    }

    return null
  },
}
