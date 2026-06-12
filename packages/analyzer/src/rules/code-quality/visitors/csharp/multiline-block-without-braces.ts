import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Braceless control-flow body followed by a statement indented AS IF it were
 * inside the block:
 *
 *     if (retry)
 *         Reconnect();
 *         Resend();      // ← looks inside, runs unconditionally
 *
 * The plain braceless single statement (`if (x == null)\n    return;`) is
 * accepted C# style and is NOT flagged — only the misleading-indentation
 * shape is.
 */
export const csharpMultilineBlockWithoutBracesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/multiline-block-without-braces',
  languages: ['csharp'],
  nodeTypes: ['if_statement', 'for_statement', 'foreach_statement', 'while_statement'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName(node.type === 'if_statement' ? 'consequence' : 'body')
    if (!body || body.type === 'block') return null
    // Single-line statements (`if (x) return;`) are safe.
    if (node.startPosition.row === body.endPosition.row) return null
    // `else` of this if would be the next sibling INSIDE the statement — only
    // look at the statement that follows the whole construct.
    const parent = node.parent
    if (!parent) return null

    let next: SyntaxNode | null = null
    let found = false
    for (const child of parent.children) {
      if (!child) continue
      if (found && child.isNamed) { next = child; break }
      if (child.id === node.id) found = true
    }
    if (!next) return null

    // Misleading only when the following statement is aligned with the
    // braceless body (deeper than the statement header).
    if (next.startPosition.column !== body.startPosition.column) return null
    if (next.startPosition.column <= node.startPosition.column) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Misleading indentation after braceless block',
      'The statement after this braceless body is indented as if it were inside the block, but it is NOT — it always executes.',
      sourceCode,
      'Add braces `{ }` around the intended block body.',
    )
  },
}
