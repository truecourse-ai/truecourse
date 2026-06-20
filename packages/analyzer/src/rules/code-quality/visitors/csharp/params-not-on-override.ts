import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'

/**
 * `params` is part of a method's calling convention, not its signature, so an
 * `override` that omits it on the variadic parameter silently removes the
 * variadic form through the derived type: callers reaching the method via the
 * override must pass an explicit array, while callers reaching the base can
 * still spread arguments (S3262). The check fires on an `override` method whose
 * last parameter is an array type without the `params` modifier — the shape an
 * override of a `params` method takes when the modifier was dropped.
 */

function lastParameter(method: SyntaxNode): SyntaxNode | null {
  const list = method.namedChildren.find((c) => c?.type === 'parameter_list')
  if (!list) return null
  const params = list.namedChildren.filter((c) => c?.type === 'parameter')
  return params.length ? params[params.length - 1]! : null
}

export const csharpParamsNotOnOverrideVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/params-not-on-override',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'override')) return null

    const last = lastParameter(node)
    if (!last) return null

    // Already variadic — nothing to flag.
    if (last.namedChildren.some((c) => c?.type === 'modifier' && c.text === 'params')) return null
    // The dropped-params shape is an array-typed final parameter.
    const type = last.namedChildren.find((c) => c?.type !== 'modifier' && c?.type !== 'attribute_list')
    if (type?.type !== 'array_type') return null

    const paramName = last.childForFieldName('name')?.text ?? last.text
    const methodName = node.childForFieldName('name')?.text ?? 'method'
    return makeViolation(
      this.ruleKey, last, filePath, 'low',
      'params dropped on override',
      `Override \`${methodName}\` declares its final array parameter \`${paramName}\` without \`params\`; if the base method is variadic, callers reaching it through this type lose the variadic call form (S3262).`,
      sourceCode,
      `Add the \`params\` modifier to \`${paramName}\` to match the base declaration.`,
    )
  },
}
