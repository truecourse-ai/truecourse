import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A global <c>[SuppressMessage(..., Target = "…")]</c> whose <c>Target</c> uses the legacy
 * FxCop format instead of the documentation-comment ID format (IDE0077). The modern format
 * always begins with a kind prefix — <c>~N:</c>, <c>~T:</c>, <c>~M:</c>, <c>~F:</c>,
 * <c>~P:</c>, <c>~E:</c> — and tools rewrite/verify it reliably; the legacy
 * <c>Namespace.Type.#Member(…)</c> form is fragile and silently stops matching after a
 * rename. Purely structural — the shape of the <c>Target</c> string.
 */
export const csharpLegacySuppressMessageTargetVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/legacy-suppressmessage-target',
  languages: ['csharp'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const name = (node.childForFieldName('name')?.text.split('.').pop() ?? '').replace(/Attribute$/, '')
    if (name !== 'SuppressMessage') return null

    const target = namedArgString(node, 'Target')
    if (target === null || target.length === 0) return null
    if (target.startsWith('~')) return null // modern documentation-ID format

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Legacy SuppressMessage target format',
      `The SuppressMessage Target "${target}" uses the legacy FxCop format; the documentation-ID format (e.g. "~M:Namespace.Type.Method(…)") is what tooling verifies and rewrites.`,
      sourceCode,
      'Rewrite the Target in documentation-ID format, prefixed with ~N:/~T:/~M:/~F:/~P:/~E:.',
    )
  },
}

/** The string value of a named attribute argument (`Name = "..."`), or null. */
function namedArgString(attr: SyntaxNode, argName: string): string | null {
  const list = attr.namedChildren.find((c) => c?.type === 'attribute_argument_list')
  if (!list) return null
  const prefix = new RegExp(`^${argName}\\s*=`)
  for (const arg of list.namedChildren) {
    if (arg?.type !== 'attribute_argument' || !prefix.test(arg.text)) continue
    const lit = findStringLiteral(arg)
    if (lit) return stringLiteralValue(lit)
  }
  return null
}

function findStringLiteral(node: SyntaxNode): SyntaxNode | null {
  if (node.type === 'string_literal' || node.type === 'verbatim_string_literal') return node
  for (const c of node.namedChildren) {
    if (!c) continue
    const found = findStringLiteral(c)
    if (found) return found
  }
  return null
}

function stringLiteralValue(lit: SyntaxNode): string {
  for (const c of lit.namedChildren) if (c?.type === 'string_literal_content') return c.text
  return lit.text.replace(/^@?"|"$/g, '')
}
