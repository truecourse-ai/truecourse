import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const COMPARISON_OPS = new Set(['==', '!=', '<', '>', '<=', '>='])

function isDateTimeNow(node: SyntaxNode): boolean {
  return node.type === 'member_access_expression' &&
    (node.text === 'DateTime.Now' || node.text.endsWith('.DateTime.Now'))
}

function isDateTimeUtcNow(node: SyntaxNode): boolean {
  return node.type === 'member_access_expression' &&
    (node.text === 'DateTime.UtcNow' || node.text.endsWith('.DateTime.UtcNow'))
}

/** Identifier / member access whose final name segment is *Utc (ExpiresUtc, lastSyncUtc). */
function isUtcNamed(node: SyntaxNode): boolean {
  if (isDateTimeUtcNow(node)) return false
  const name = node.type === 'identifier'
    ? node.text
    : node.type === 'member_access_expression'
      ? (node.childForFieldName('name')?.text ?? '')
      : ''
  return name.length > 'Utc'.length && name.endsWith('Utc')
}

/**
 * Mixing local `DateTime.Now` with UTC values in one comparison or
 * subtraction — the operands are in different timezones, so the result is
 * off by the UTC offset. Bare `DateTime.Now` is NOT flagged (legitimate
 * for local-time display), nor is `DateTime.Now - DateTime.UtcNow` (the
 * standard way to compute the local UTC offset).
 */
export const csharpDatetimeWithoutTimezoneVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/datetime-without-timezone',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text ?? ''
    if (!COMPARISON_OPS.has(op) && op !== '-') return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    const nowSide = isDateTimeNow(left) ? left : isDateTimeNow(right) ? right : null
    if (!nowSide) return null
    const otherSide = nowSide === left ? right : left

    // DateTime.Now vs DateTime.UtcNow: comparisons are always a kind
    // mismatch; subtraction is the idiomatic UTC-offset computation — skip.
    if (isDateTimeUtcNow(otherSide)) {
      if (!COMPARISON_OPS.has(op)) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Local and UTC datetimes mixed',
        `\`${node.text}\` compares local \`DateTime.Now\` with \`DateTime.UtcNow\` — the operands differ by the UTC offset, so the comparison is meaningless.`,
        sourceCode,
        'Use the same kind on both sides — typically DateTime.UtcNow.',
      )
    }

    if (isUtcNamed(otherSide)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Local and UTC datetimes mixed',
        `\`${node.text}\` mixes local \`DateTime.Now\` with \`${otherSide.text}\`, which is named as a UTC value — the result is off by the machine's UTC offset.`,
        sourceCode,
        `Use \`DateTime.UtcNow\` when working with UTC timestamps like \`${otherSide.text}\`.`,
      )
    }

    return null
  },
}
