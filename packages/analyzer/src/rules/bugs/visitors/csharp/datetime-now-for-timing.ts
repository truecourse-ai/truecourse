import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const DURATION_PROPS = new Set([
  'TotalMilliseconds', 'TotalSeconds', 'TotalMinutes', 'TotalHours', 'TotalDays',
  'TotalMicroseconds', 'TotalNanoseconds', 'Milliseconds', 'Ticks',
])

/**
 * Elapsed time measured by subtracting two `DateTime.Now`/`UtcNow` readings. The
 * system clock is not monotonic — NTP corrections, DST shifts and manual changes
 * can move it backward — so the duration can be wrong or negative, and `DateTime`
 * resolution is coarse. `Stopwatch` is the monotonic, high-resolution alternative.
 * Flagged only when the subtraction is consumed as a duration (a `Total*`/ticks
 * property), which is unambiguously a timing measurement, not calendar arithmetic.
 */
export const csharpDateTimeNowForTimingVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/datetime-now-for-timing',
  languages: ['csharp'],
  nodeTypes: ['member_access_expression'],
  visit(node, filePath, sourceCode) {
    if (!DURATION_PROPS.has(node.childForFieldName('name')?.text ?? '')) return null

    const receiver = unwrap(node.childForFieldName('expression'))
    if (!receiver || receiver.type !== 'binary_expression') return null
    if (receiver.childForFieldName('operator')?.text !== '-') return null

    const left = receiver.childForFieldName('left')
    const right = receiver.childForFieldName('right')
    if (!isWallClockNow(left) && !isWallClockNow(right)) return null

    return makeViolation(
      this.ruleKey, receiver, filePath, 'medium',
      'Elapsed time measured with DateTime.Now',
      'Elapsed time measured from DateTime.Now/UtcNow — the wall clock is not monotonic; use Stopwatch.',
      sourceCode,
      'Measure elapsed time with System.Diagnostics.Stopwatch instead.',
    )
  },
}

function unwrap(node: SyntaxNode | null): SyntaxNode | null {
  if (node?.type === 'parenthesized_expression') return unwrap(node.namedChild(0))
  return node
}

/** True for `DateTime.Now` or `DateTime.UtcNow`. */
function isWallClockNow(node: SyntaxNode | null): boolean {
  const n = unwrap(node)
  if (!n || n.type !== 'member_access_expression') return false
  const name = n.childForFieldName('name')?.text
  return (name === 'Now' || name === 'UtcNow') && n.childForFieldName('expression')?.text === 'DateTime'
}
