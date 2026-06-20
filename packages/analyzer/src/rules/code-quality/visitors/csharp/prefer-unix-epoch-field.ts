import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Constructing the Unix epoch by hand — `new DateTime(1970, 1, 1, …)` — when
 * the framework exposes `DateTime.UnixEpoch` (and `DateTimeOffset.UnixEpoch`)
 * restates a well-known constant in a way readers must decode (S6588). The
 * check fires on an `object_creation_expression` of `DateTime` /
 * `DateTimeOffset` whose first three positional arguments are the integer
 * literals `1970`, `1`, `1`, and whose remaining positional time arguments (if
 * any) are all zero — i.e. exactly midnight on the epoch date.
 */

function typeName(node: SyntaxNode): string | null {
  const type = node.namedChildren.find((c) => c?.type !== 'argument_list' && c?.type !== 'initializer_expression')
  if (!type) return null
  return type.text.split('.').pop() ?? type.text
}

function positionalIntArgs(node: SyntaxNode): (string | null)[] {
  const list = node.namedChildren.find((c) => c?.type === 'argument_list')
  if (!list) return []
  return list.namedChildren
    .filter((c) => c?.type === 'argument')
    .map((arg) => {
      // A named argument or a non-literal positional breaks the literal check.
      if (arg!.children.some((c) => c?.type === ':')) return null
      const value = arg!.namedChildren[0]
      return value?.type === 'integer_literal' ? value.text : '__nonliteral__'
    })
}

export const csharpPreferUnixEpochFieldVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-unix-epoch-field',
  languages: ['csharp'],
  nodeTypes: ['object_creation_expression'],
  visit(node, filePath, sourceCode) {
    const name = typeName(node)
    if (name !== 'DateTime' && name !== 'DateTimeOffset') return null

    const args = positionalIntArgs(node)
    // Need at least the year/month/day; fewer than 3 isn't the epoch shape.
    if (args.length < 3) return null
    if (args[0] !== '1970' || args[1] !== '1' || args[2] !== '1') return null

    // Any further positional time component (hour/min/sec/ms) must be zero;
    // a non-literal trailing argument (a TimeSpan offset, a DateTimeKind) is
    // fine — those are passed through to the UnixEpoch field's semantics.
    for (const extra of args.slice(3)) {
      if (extra === '__nonliteral__') continue
      if (extra !== '0') return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use the UnixEpoch field instead of constructing the epoch',
      `\`new ${name}(1970, 1, 1, …)\` reconstructs the Unix epoch by hand; \`${name}.UnixEpoch\` names the same constant directly (S6588).`,
      sourceCode,
      `Replace the hand-built epoch with \`${name}.UnixEpoch\`.`,
    )
  },
}
