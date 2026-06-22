import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A generic *method* declaring many type parameters forces every call site to
 * infer or spell out all of them, a brain-overload signal. Scoped to
 * `method_declaration` / `local_function_statement` so it never overlaps
 * `too-many-type-parameters`, which owns the type-declaration count. The
 * threshold mirrors that rule: three or more type parameters fire, leaving the
 * common two-parameter (`TKey, TValue`) method unflagged.
 */

const MAX_TYPE_PARAMETERS = 2

export const csharpTooManyGenericParametersVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-generic-parameters',
  languages: ['csharp'],
  nodeTypes: ['method_declaration', 'local_function_statement'],
  visit(node, filePath, sourceCode) {
    const list = node.namedChildren.find((c) => c?.type === 'type_parameter_list')
    if (!list) return null
    const count = list.namedChildren.filter((c) => c?.type === 'type_parameter').length
    if (count <= MAX_TYPE_PARAMETERS) return null

    const name = node.childForFieldName('name')?.text ?? 'method'
    const nameNode: SyntaxNode = node.childForFieldName('name') ?? node
    return makeViolation(
      this.ruleKey, nameNode, filePath, 'low',
      'Too many generic parameters',
      `Method \`${name}\` declares ${count} generic type parameters (> ${MAX_TYPE_PARAMETERS}), which callers must infer or spell out at every call.`,
      sourceCode,
      `Reduce \`${name}\`'s type parameters, or split it into smaller generic methods.`,
    )
  },
}
