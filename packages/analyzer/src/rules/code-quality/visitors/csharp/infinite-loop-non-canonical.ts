import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** A `(true)` / `(1 == 1)`-style always-true literal condition. */
function isLiteralTrue(node: SyntaxNode | null): boolean {
  if (!node) return false
  let n = node
  while (n.type === 'parenthesized_expression') {
    const inner = n.namedChildren.find((c) => c != null)
    if (!inner) return false
    n = inner
  }
  return n.type === 'boolean_literal' && n.text === 'true'
}

/**
 * An intentional infinite loop has one canonical spelling: `while (true)`.
 * Writing it as `for (;;)` (no condition) or `do { … } while (true)` makes the
 * reader stop and confirm the intent that `while (true)` states outright
 * (RCS1063). `for (;;)` is detected by the absent `condition` field;
 * `do/while(true)` by a literal-true tail condition.
 */
export const csharpInfiniteLoopNonCanonicalVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/infinite-loop-non-canonical',
  languages: ['csharp'],
  nodeTypes: ['for_statement', 'do_statement'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'for_statement') {
      // A canonical infinite `for` omits the condition entirely.
      if (node.childForFieldName('condition')) return null
      // Only flag the bare `for (;;)` form — `for (init; ; incr)` is rare but
      // legitimate and not what this rule targets.
      const initializer = node.childForFieldName('initializer')
      const update = node.childForFieldName('update')
      if (initializer || update) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Non-canonical infinite loop',
        '`for (;;)` is a non-canonical infinite loop — `while (true)` states the same intent more recognisably (RCS1063).',
        sourceCode,
        'Rewrite the loop as `while (true)`.',
      )
    }

    // do { … } while (true)
    if (!isLiteralTrue(node.childForFieldName('condition'))) return null
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Non-canonical infinite loop',
      '`do { … } while (true)` is a non-canonical infinite loop — `while (true)` is the recognisable form (RCS1063).',
      sourceCode,
      'Rewrite the loop as `while (true)`.',
    )
  },
}
