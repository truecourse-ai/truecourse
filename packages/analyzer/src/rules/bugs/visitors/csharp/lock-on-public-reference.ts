import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { unwrapParens } from './_helpers.js'

/**
 * Describes what kind of publicly reachable object a lock target is, or null
 * when the target is a private/dedicated lock object.
 */
function publicLockKind(target: SyntaxNode): string | null {
  if (target.type === 'this_expression' || target.text === 'this') return '`this`'
  if (target.type === 'typeof_expression') return 'a Type instance (`typeof(...)`)'
  if (
    target.type === 'string_literal' ||
    target.type === 'verbatim_string_literal' ||
    target.type === 'raw_string_literal' ||
    target.type === 'interpolated_string_expression'
  ) {
    return 'a string (interned strings are shared process-wide)'
  }
  return null
}

/**
 * `lock` taken on a publicly reachable object — `this`, a `typeof(...)` Type
 * instance, or a string literal. Any unrelated code that can reach the same
 * reference can acquire the same monitor, producing non-obvious deadlocks. A
 * lock should be taken on a private, dedicated sync object.
 *
 * Only the unambiguously public targets above are flagged; locking on a named
 * field is handled by the field-specific lock rules, so this rule does not
 * double-report there.
 */
export const csharpLockOnPublicReferenceVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/lock-on-public-reference',
  languages: ['csharp'],
  nodeTypes: ['lock_statement'],
  visit(node, filePath, sourceCode) {
    // The locked expression sits between `(` and `)`; `this`/`typeof` keywords
    // can be anonymous tokens, so scan all children rather than named ones.
    let target: SyntaxNode | null = null
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)
      if (!child) continue
      if (child.type === 'lock' || child.type === '(' || child.type === ')' || child.type === 'block') {
        continue
      }
      target = child
      break
    }
    if (!target) return null

    const unwrapped = unwrapParens(target)
    const kind = publicLockKind(unwrapped)
    if (!kind) return null

    return makeViolation(
      this.ruleKey, target, filePath, 'high',
      'Lock on a publicly accessible object',
      `Locking on ${kind} lets unrelated code acquire the same monitor, creating non-obvious deadlocks.`,
      sourceCode,
      'Lock on a private, dedicated `readonly object` sync field instead.',
    )
  },
}
