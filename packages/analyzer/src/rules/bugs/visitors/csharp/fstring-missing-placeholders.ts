import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

function hasInterpolation(node: SyntaxNode): boolean {
  return node.namedChildren.some((c) => c?.type === 'interpolation')
}

/**
 * `$"…"` with no `{…}` holes — the `$` prefix is unnecessary, or the
 * interpolation was forgotten. Mirrors Python's f-string rule.
 *
 * When the string is part of a `+` concatenation chain where a sibling
 * interpolated string HAS holes (a long interpolation split across lines),
 * it is not flagged.
 */
export const csharpFstringMissingPlaceholdersVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/fstring-missing-placeholders',
  languages: ['csharp'],
  nodeTypes: ['interpolated_string_expression'],
  visit(node, filePath, sourceCode) {
    if (hasInterpolation(node)) return null

    let top: SyntaxNode = node
    while (top.parent?.type === 'binary_expression' &&
           top.parent.childForFieldName('operator')?.text === '+') {
      top = top.parent
    }
    if (top.id !== node.id) {
      let siblingHasHoles = false
      const walk = (n: SyntaxNode): void => {
        if (siblingHasHoles) return
        if (n.type === 'interpolated_string_expression' && n.id !== node.id && hasInterpolation(n)) {
          siblingHasHoles = true
          return
        }
        for (const child of n.namedChildren) {
          if (child) walk(child)
        }
      }
      walk(top)
      if (siblingHasHoles) return null
    }

    const preview = node.text.length > 60 ? `${node.text.slice(0, 60)}…` : node.text
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Interpolated string without placeholders',
      `\`${preview}\` is an interpolated string but contains no \`{...}\` holes — the \`$\` prefix is unnecessary or the interpolation was forgotten.`,
      sourceCode,
      'Remove the `$` prefix if no interpolation is needed, or add `{expression}` placeholders.',
    )
  },
}
