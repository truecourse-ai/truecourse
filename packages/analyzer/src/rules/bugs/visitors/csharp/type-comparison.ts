import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES } from './_helpers.js'

function isGetTypeCall(node: SyntaxNode): boolean {
  if (node.type !== 'invocation_expression') return false
  const fn = node.childForFieldName('function')
  const name = fn?.type === 'identifier' ? fn.text
    : fn?.type === 'member_access_expression' ? (fn.childForFieldName('name')?.text ?? '') : ''
  if (name !== 'GetType') return false
  return (node.childForFieldName('arguments')?.namedChildren.length ?? 0) === 0
}

/** Inside an Equals override exact-type comparison is the idiom — skip. */
function isInsideEquals(node: SyntaxNode): boolean {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (CSHARP_FUNCTION_BOUNDARIES.has(current.type)) {
      return current.childForFieldName('name')?.text === 'Equals'
    }
    current = current.parent
  }
  return false
}

/**
 * `x.GetType() == typeof(T)` — an EXACT runtime-type check that silently
 * excludes subclasses, where `x is T` (which matches subclasses too) is
 * almost always what polymorphic code means. Equals overrides are skipped
 * — exact-type comparison is correct there.
 */
export const csharpTypeComparisonVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/type-comparison-instead-of-isinstance',
  languages: ['csharp'],
  nodeTypes: ['binary_expression'],
  visit(node, filePath, sourceCode) {
    const op = node.childForFieldName('operator')?.text
    if (op !== '==' && op !== '!=') return null

    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    if (!left || !right) return null

    const getTypeSide = isGetTypeCall(left) ? left : isGetTypeCall(right) ? right : null
    const typeofSide = left.type === 'typeof_expression' ? left : right.type === 'typeof_expression' ? right : null
    if (!getTypeSide || !typeofSide) return null

    if (isInsideEquals(node)) return null

    const typeName = typeofSide.childForFieldName('type')?.text ?? 'T'
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Direct type comparison',
      `\`${node.text}\` compares the EXACT runtime type — instances of subclasses of ${typeName} will ${op === '==' ? 'not match' : 'match'}. \`is ${typeName}\` also matches subclasses, which is usually the intent.`,
      sourceCode,
      `Use \`obj is ${typeName}\` (matches subclasses) unless the exact-type semantics are deliberate — in that case consider documenting it.`,
    )
  },
}
