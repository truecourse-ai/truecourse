import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

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

    // Multi-line concat where every part except possibly the last ends with
    // whitespace is the canonical Python idiom for splitting one logical
    // string across lines for readability. Skip those. Multi-line without
    // trailing whitespace (e.g. `"moderator"\n"viewer"`) is far more likely
    // to be a missing comma between two list elements - keep firing on it.
    if (node.startPosition.row !== node.endPosition.row) {
      const parts = node.namedChildren
      let allButLastEndWithSpace = parts.length > 1
      for (let i = 0; i < parts.length - 1; i++) {
        const t = parts[i].text
        const inner = t.replace(/['"]+$/, '')
        const lastChar = inner.charAt(inner.length - 1)
        if (lastChar !== ' ' && lastChar !== '\\' && lastChar !== '\t') {
          allButLastEndWithSpace = false
          break
        }
      }
      if (allButLastEndWithSpace) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Implicit string concatenation in collection',
      'Adjacent string literals in a collection are implicitly concatenated — this may be a missing comma.',
      sourceCode,
      'Add a comma between the strings, or use explicit `+` concatenation if intentional.',
    )
  },
}
