import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A raw string literal (`"""…"""`) earns its visual weight only when the
 * content contains characters a regular literal would have to escape — double
 * quotes, backslashes — or spans multiple lines. When the content has none of
 * those, a plain `"…"` says the same thing with less ceremony (RCS1262). The
 * check fires on a single-line `raw_string_literal` whose content contains no
 * `"`, no `\`, and is not interpolated.
 */

function rawContent(node: SyntaxNode): string | null {
  const content = node.namedChildren.find((c) => c?.type === 'raw_string_content' || c?.type === 'raw_string_literal_content')
  return content?.text ?? ''
}

export const csharpUnnecessaryRawStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-raw-string',
  languages: ['csharp'],
  nodeTypes: ['raw_string_literal'],
  visit(node, filePath, sourceCode) {
    // Interpolated raw strings (`$"""…"""`) are a separate construct
    // (interpolated_raw_string_expression); this node type is non-interpolated.
    const content = rawContent(node)
    if (content == null) return null

    // Multi-line content needs the raw form.
    if (content.includes('\n')) return null
    // Quotes or backslashes are exactly what a regular literal would escape;
    // the raw form is earning its keep.
    if (content.includes('"') || content.includes('\\')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary raw string literal',
      'This raw string literal contains no quotes, backslashes, or newlines, so a plain string literal expresses it with less visual weight (RCS1262).',
      sourceCode,
      'Replace the raw string literal with a regular `"…"` literal.',
    )
  },
}
