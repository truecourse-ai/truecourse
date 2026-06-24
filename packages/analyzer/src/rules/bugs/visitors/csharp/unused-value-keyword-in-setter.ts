import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A property/indexer setter (or an `init` accessor) that never reads the
 * implicit `value` keyword. The assigned value is silently dropped — the setter
 * stores nothing the caller passed, which is almost always a copy-paste or
 * refactoring mistake.
 *
 * Auto-implemented accessors (`set;`) have no body and are skipped. Any
 * reference to `value` anywhere in the accessor body clears the violation, so a
 * nested lambda that legitimately consumes it never trips a false positive.
 */
function referencesValue(node: SyntaxNode): boolean {
  if (node.type === 'identifier' && node.text === 'value') {
    // Not the `name` side of `x.value` member access nor a declaration.
    const parent = node.parent
    if (
      parent?.type === 'member_access_expression' &&
      parent.childForFieldName('name')?.id === node.id
    ) {
      return false
    }
    return true
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child && referencesValue(child)) return true
  }
  return false
}

export const csharpUnusedValueKeywordInSetterVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/unused-value-keyword-in-setter',
  languages: ['csharp'],
  nodeTypes: ['accessor_declaration'],
  visit(node, filePath, sourceCode) {
    const accessorKind = node.childForFieldName('name')?.text
    if (accessorKind !== 'set' && accessorKind !== 'init') return null

    const body = node.childForFieldName('body')
    // Auto-implemented (`set;`) or expression-bodied; only block bodies are
    // analysed because an expression body is a single expression that almost
    // always uses value, and treating arrow bodies needs separate handling.
    if (body?.type !== 'block') return null

    // Empty body is a different (no-op accessor) concern; require real code.
    const hasStatements = body.namedChildren.some(
      (c) => c && c.type !== 'comment',
    )
    if (!hasStatements) return null

    if (referencesValue(body)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Setter ignores the assigned value',
      'This setter never references the `value` keyword, so the value the caller assigns is silently discarded.',
      sourceCode,
      'Use the `value` keyword to store the assigned value.',
    )
  },
}
