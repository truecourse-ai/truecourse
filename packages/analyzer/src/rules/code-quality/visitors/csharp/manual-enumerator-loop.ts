import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/** The method name of `recv.Member(...)` / `recv.Member`, or null. */
function memberName(node: SyntaxNode): string | null {
  if (node.type === 'invocation_expression') {
    const target = node.childForFieldName('function')
    if (target?.type === 'member_access_expression') return target.childForFieldName('name')?.text ?? null
    return null
  }
  if (node.type === 'member_access_expression') return node.childForFieldName('name')?.text ?? null
  return null
}

/** The receiver identifier of `recv.MoveNext()`. */
function invocationReceiver(node: SyntaxNode): string | null {
  if (node.type !== 'invocation_expression') return null
  const target = node.childForFieldName('function')
  if (target?.type !== 'member_access_expression') return null
  const recv = target.childForFieldName('expression')
  return recv?.type === 'identifier' ? recv.text : null
}

/**
 * Driving an enumerator by hand — `var e = src.GetEnumerator(); while
 * (e.MoveNext()) { … e.Current … }` — reimplements `foreach`, which is shorter
 * and (unlike the hand-rolled loop) guarantees the enumerator is disposed
 * (RCS1230). Detected structurally: a local initialized from a
 * `*.GetEnumerator()` call whose enumerator variable then guards a `while`
 * via `MoveNext()`. Tightly scoped (immediate-sibling decl + while, same
 * receiver) so partial hand-rolled state machines are not misread.
 */
export const csharpManualEnumeratorLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/manual-enumerator-loop',
  languages: ['csharp'],
  nodeTypes: ['local_declaration_statement'],
  visit(node, filePath, sourceCode) {
    const decl = node.namedChildren.find((c) => c?.type === 'variable_declaration')
    if (!decl) return null
    const declarator = decl.namedChildren.find((c) => c?.type === 'variable_declarator')
    if (!declarator) return null
    const nameNode = declarator.childForFieldName('name')
    const enumVar = nameNode?.text
    if (!nameNode || !enumVar) return null

    // The initializer is the named child after `name` (the `= expr` value).
    const init = declarator.namedChildren.find((c) => c != null && c.id !== nameNode.id)
    if (!init || init.type !== 'invocation_expression') return null
    if (memberName(init) !== 'GetEnumerator') return null

    // The next statement must be a while loop guarded by enumVar.MoveNext().
    let sibling: SyntaxNode | null = node.nextNamedSibling
    while (sibling && sibling.type === 'comment') sibling = sibling.nextNamedSibling
    if (!sibling || sibling.type !== 'while_statement') return null

    const cond = sibling.childForFieldName('condition')
    if (!cond) return null
    if (memberName(cond) !== 'MoveNext') return null
    if (invocationReceiver(cond) !== enumVar) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Manual enumerator loop',
      `Driving \`${enumVar}\` with \`GetEnumerator\`/\`MoveNext\` reimplements \`foreach\`, which is shorter and disposes the enumerator automatically (RCS1230).`,
      sourceCode,
      'Replace the manual enumerator loop with a `foreach` over the source.',
    )
  },
}
