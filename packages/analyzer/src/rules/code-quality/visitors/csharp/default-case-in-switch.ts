import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function isDefaultSection(section: SyntaxNode): boolean {
  // `default:` label or the `_` discard pattern (`case _:` is not legal, but
  // `case var _:` is).
  return section.children.some((c) => c?.type === 'default')
    || section.namedChildren.some((c) => c?.type === 'discard')
}

export const csharpDefaultCaseInSwitchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/default-case-in-switch',
  languages: ['csharp'],
  // Switch EXPRESSIONS are exempt: the compiler itself warns on
  // non-exhaustive switch expressions (CS8509), so a missing `_` arm is
  // already surfaced.
  nodeTypes: ['switch_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const sections = body.namedChildren.filter((c) => c?.type === 'switch_section') as SyntaxNode[]
    if (sections.length < 2) return null
    if (sections.some(isDefaultSection)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Missing default case in switch',
      'Switch statement has no `default` case — unexpected values are silently ignored.',
      sourceCode,
      'Add a `default` case to handle (or explicitly reject) unexpected values.',
    )
  },
}
