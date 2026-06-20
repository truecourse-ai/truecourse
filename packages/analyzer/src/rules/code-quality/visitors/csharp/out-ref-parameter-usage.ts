import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * A public API that takes an `out` or `ref` parameter pushes a second output
 * channel onto callers, who must declare a variable up front and read it after
 * the call; the result is harder to compose than a return value or a result
 * object (S3874). The check fires on a `public` method whose parameter list
 * contains a parameter with an `out` or `ref` modifier.
 *
 * The well-known `bool TryParse(string, out T)` shape is exempt: the `Try`
 * prefix is the established idiom for which `out` is the sanctioned form, so
 * flagging it would be noise.
 */

function isTryPattern(method: SyntaxNode): boolean {
  const name = method.childForFieldName('name')?.text ?? ''
  return name.startsWith('Try')
}

export const csharpOutRefParameterUsageVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/out-ref-parameter-usage',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'public')) return null
    if (hasCSharpModifier(node, 'override')) return null
    if (isTryPattern(node)) return null

    const params = node.namedChildren.find((c) => c?.type === 'parameter_list')
    if (!params) return null

    const offending = params.namedChildren.find((p) =>
      p?.type === 'parameter' && p.namedChildren.some((c) => c?.type === 'modifier' && (c.text === 'out' || c.text === 'ref')),
    )
    if (!offending) return null

    const kind = offending.namedChildren.find((c) => c?.type === 'modifier')?.text ?? 'out'
    const paramName = offending.childForFieldName('name')?.text ?? offending.text
    return makeViolation(
      this.ruleKey, offending, filePath, 'low',
      'out/ref parameter on a public API',
      `Public method exposes \`${kind}\` parameter \`${paramName}\`, which complicates call sites; prefer a return type or a result object (S3874).`,
      sourceCode,
      `Return the value (or a result object) instead of writing through the \`${kind}\` parameter.`,
    )
  },
}
