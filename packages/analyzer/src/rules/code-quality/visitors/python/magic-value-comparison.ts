import type { SyntaxNode } from 'tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Numbers that are universally understood and shouldn't require a named constant.
const SAFE_NUMBERS = new Set(['0', '1', '-1', '2', 'True', 'False', 'None'])

// HTTP methods — common tag strings, never a "magic" value.
const HTTP_METHODS = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|CONNECT|TRACE)$/

// Enum-like identifier strings: "run", "done", "CANCELLED", "in_progress".
// Short snake_case / UPPER_CASE / camelCase identifiers used as tags.
const ENUM_LIKE_STRING = /^[A-Za-z_][A-Za-z0-9_]*$/

// File extensions: ".pdf", ".tar.gz", ".jpg".
const FILE_EXTENSION = /^\.[a-z0-9.]{1,10}$/

// Dunder strings: "__main__", "__init__", "__all__".
const DUNDER_STRING = /^__\w+__$/

// MIME types: "application/json", "text/html".
const MIME_TYPE = /^[a-z]+\/[a-z0-9+.\-]+$/

/**
 * True if the OTHER operand (the non-literal side of the comparison) gives
 * the literal enough context that it's not really "magic" to a human reader.
 *
 * `response.status == 200` — `status` tells you 200 is an HTTP code.
 * `d["count"] == 5` — the key tells you what 5 means.
 *
 * Call results like `len(items) > 20` are NOT skipped — the 20 is still
 * unexplained and genuinely warrants extracting to a named constant.
 */
function hasContextualOtherOperand(node: SyntaxNode, literal: SyntaxNode): boolean {
  for (const operand of node.namedChildren) {
    if (operand.id === literal.id) continue
    // Attribute access: `x.y`, `x.y.z`
    if (operand.type === 'attribute') return true
    // Subscript: `d["key"]`, `arr[i]`
    if (operand.type === 'subscript') return true
  }
  return false
}

/** True if the string literal is an idiomatic tag / extension / etc. */
function isIdiomaticString(stringNode: SyntaxNode): boolean {
  // Strip Python string prefix + quotes: `b"foo"`, `r'bar'`, `"baz"`.
  // The tree-sitter Python `string` node wraps `string_start` / `string_content` / `string_end`.
  const content = stringNode.namedChildren.find((c) => c.type === 'string_content')
  const inner = content?.text ?? stringNode.text.replace(/^[a-zA-Z]*['"]/, '').replace(/['"]$/, '')

  if (inner.length === 0) return true
  if (inner.length === 1) return true // single-char sep / delim
  if (DUNDER_STRING.test(inner)) return true
  if (HTTP_METHODS.test(inner)) return true
  if (FILE_EXTENSION.test(inner)) return true
  if (MIME_TYPE.test(inner)) return true
  if (inner.length <= 32 && ENUM_LIKE_STRING.test(inner)) return true
  return false
}

export const pythonMagicValueComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/magic-value-comparison',
  languages: ['python'],
  nodeTypes: ['comparison_operator'],
  visit(node, filePath, sourceCode) {
    for (const operand of node.namedChildren) {
      if (operand.type === 'integer' || operand.type === 'float') {
        if (SAFE_NUMBERS.has(operand.text)) continue
        // Skip if the other operand gives the number context.
        if (hasContextualOtherOperand(node, operand)) continue
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Magic value comparison',
          `Comparing against magic number \`${operand.text}\` — extract to a named constant for clarity.`,
          sourceCode,
          'Extract the magic value to a named constant at module or class level.',
        )
      }
      if (operand.type === 'string') {
        if (isIdiomaticString(operand)) continue
        // Skip if the other operand gives the string context.
        if (hasContextualOtherOperand(node, operand)) continue
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Magic value comparison',
          `Comparing against magic string \`${operand.text}\` — extract to a named constant for clarity.`,
          sourceCode,
          'Extract the magic string to a named constant at module or class level.',
        )
      }
    }
    return null
  },
}
