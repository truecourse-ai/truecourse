import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** `else { if (…) { … } }` — the block wrapper adds a nesting level for nothing. */
export function csharpLonelyIfInElse(ifStatement: SyntaxNode): SyntaxNode | null {
  const alternative = ifStatement.childForFieldName('alternative')
  if (!alternative || alternative.type !== 'block') return null
  if (alternative.namedChildCount !== 1) return null
  const only = alternative.namedChildren[0]
  if (only?.type !== 'if_statement') return null
  return alternative
}

export const csharpCollapsibleElseIfVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/collapsible-else-if',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const lonely = csharpLonelyIfInElse(node)
    if (!lonely) return null

    return makeViolation(
      this.ruleKey, lonely, filePath, 'low',
      'Collapsible else-if',
      '`else { if (…) }` should be written as `else if (…)` to reduce nesting.',
      sourceCode,
      'Replace `else { if (…) { … } }` with `else if (…) { … }`.',
    )
  },
}
