import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * An event named with a `Before`/`After` prefix bakes ordering into the name
 * where a verb tense conveys it more naturally and consistently with the BCL
 * convention (CA1713): `Closing`/`Closed` rather than `BeforeClose`/`AfterClose`.
 * The check targets event names on `event_field_declaration` (and the
 * accessor-bearing `event_declaration`) starting with `Before` or `After`
 * followed by an uppercase letter, so it never matches words like `Afterglow`
 * by accident.
 */

function eventNames(node: SyntaxNode): SyntaxNode[] {
  if (node.type === 'event_declaration') {
    const name = node.childForFieldName('name')
    return name ? [name] : []
  }
  const decl = node.namedChildren.find((c) => c?.type === 'variable_declaration')
  if (!decl) return []
  return decl.namedChildren
    .filter((c) => c?.type === 'variable_declarator')
    .map((d) => d!.childForFieldName('name') ?? d!.namedChildren[0])
    .filter((n): n is SyntaxNode => n != null)
}

export const csharpEventBeforeAfterPrefixVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/event-before-after-prefix',
  languages: ['csharp'],
  nodeTypes: ['event_field_declaration', 'event_declaration'],
  visit(node, filePath, sourceCode) {
    for (const nameNode of eventNames(node)) {
      const match = nameNode.text.match(/^(Before|After)(?=[A-Z])/)
      if (!match) continue
      return makeViolation(
        this.ruleKey, nameNode, filePath, 'low',
        'Event named with Before/After prefix',
        `Event \`${nameNode.text}\` uses a \`${match[1]}\` prefix; a present/past-tense verb name (e.g. \`Closing\`/\`Closed\`) conveys ordering more naturally (CA1713).`,
        sourceCode,
        `Rename \`${nameNode.text}\` to a verb-tense form instead of a \`${match[1]}\` prefix.`,
      )
    }
    return null
  },
}
