import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { findInSameFunction, isInsideAsyncFunction } from './_helpers.js'

const COMPOUND_OPS = new Set(['+=', '-=', '*=', '/=', '|=', '&='])

/**
 * Is the assignment target shared state by C# conventions?
 *   - `this.X` — instance field/property
 *   - `_total` / `s_total` — private-field naming conventions
 *   - `Metrics.Total` — static member of a PascalCase type
 * Plain camelCase locals are skipped — a local has no concurrent writers.
 */
function isSharedTarget(left: SyntaxNode): boolean {
  if (left.type === 'identifier') return /^(_|s_)[A-Za-z0-9_]/.test(left.text)
  if (left.type === 'member_access_expression') {
    const receiver = left.childForFieldName('expression')
    if (!receiver) return false
    if (receiver.type === 'this_expression') return true
    return receiver.type === 'identifier' && /^[A-Z]/.test(receiver.text)
  }
  return false
}

/**
 * `_counter += await ...` — reads the shared field, suspends at the await
 * (releasing the thread), then writes back. A concurrent update between
 * the read and the write is silently overwritten.
 */
export const csharpRaceConditionAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/race-condition-assignment',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text ?? ''
    if (!COMPOUND_OPS.has(op)) return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right || !isSharedTarget(left)) return null

    if (!findInSameFunction(right, (n) => n.type === 'await_expression')) return null
    if (!isInsideAsyncFunction(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Race condition assignment',
      `\`${left.text} ${op} await ...\` reads \`${left.text}\`, suspends at the \`await\`, and writes back — a concurrent modification between the read and the write is silently overwritten.`,
      sourceCode,
      'Await into a local first, then apply the update atomically (e.g. Interlocked.Add or a lock).',
    )
  },
}
