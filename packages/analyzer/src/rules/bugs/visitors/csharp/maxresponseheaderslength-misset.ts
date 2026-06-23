import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// HttpClientHandler.MaxResponseHeadersLength is measured in KILOBYTES (default 64).
// A value this large only makes sense if the author thought it was bytes — a real
// header budget never approaches a megabyte, so anything over 1024 KB is the
// unit-confusion bug this rule targets.
const KB_SANITY_CEILING = 1024

/**
 * <c>MaxResponseHeadersLength</c> assigned a value that ignores its kilobyte unit.
 * The property caps response headers in KB (default 64); setting it to a
 * bytes-scale number like <c>65536</c> configures a ~64&nbsp;MB header budget,
 * defeating the protection against unbounded-header attacks. Flagged only for
 * literal assignments above a generous KB ceiling, so legitimate large-but-sane
 * limits are never reported.
 */
export const csharpMaxResponseHeadersLengthMissetVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/maxresponseheaderslength-misset',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    if (!isMaxResponseHeaders(node.childForFieldName('left'))) return null
    const value = intLiteralValue(node.childForFieldName('right'))
    if (value === null || value <= KB_SANITY_CEILING) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'MaxResponseHeadersLength set with the wrong unit',
      `MaxResponseHeadersLength is in kilobytes (default 64); the value ${value} looks like bytes and configures a wildly oversized header budget.`,
      sourceCode,
      'Set MaxResponseHeadersLength in kilobytes (e.g. 64), not bytes.',
    )
  },
}

/** True for `MaxResponseHeadersLength` as a bare target or a member access. */
function isMaxResponseHeaders(left: SyntaxNode | null): boolean {
  if (!left) return false
  if (left.type === 'identifier') return left.text === 'MaxResponseHeadersLength';
  if (left.type === 'member_access_expression') return left.childForFieldName('name')?.text === 'MaxResponseHeadersLength';
  return false
}

function intLiteralValue(node: SyntaxNode | null): number | null {
  if (!node || node.type !== 'integer_literal') return null
  const t = node.text.replace(/_/g, '').replace(/[uUlL]+$/, '')
  const v = /^0x/i.test(t) ? parseInt(t.slice(2), 16) : /^0b/i.test(t) ? parseInt(t.slice(2), 2) : parseInt(t, 10)
  return Number.isFinite(v) ? v : null
}
