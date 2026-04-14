import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function isCollection(node: SyntaxNode): boolean {
  return node.type === 'list' || node.type === 'tuple' || node.type === 'set'
}

export const pythonImplicitStringConcatenationVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/implicit-string-concatenation',
  languages: ['python'],
  nodeTypes: ['concatenated_string'],
  visit(node, filePath, sourceCode) {
    // Only flag when inside a list, tuple, or set literal
    const parent = node.parent
    if (!parent) return null
    // Parent could be the collection directly or expression list
    const grandparent = parent.parent
    if (!isCollection(parent) && !isCollection(grandparent ?? { type: '' } as SyntaxNode)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Implicit string concatenation in collection',
      'Adjacent string literals in a collection are implicitly concatenated — this may be a missing comma.',
      sourceCode,
      'Add a comma between the strings, or use explicit `+` concatenation if intentional.',
    )
  },
}
