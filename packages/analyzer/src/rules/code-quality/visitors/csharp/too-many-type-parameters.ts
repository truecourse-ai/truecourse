import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A type with more than this many generic parameters is hard to read and to
 * instantiate correctly — every call site must supply or infer all of them.
 * CA1005 uses two as the guideline; we flag three or more to leave the common
 * `Dictionary<TKey, TValue>`-style pair unflagged.
 */
const MAX_TYPE_PARAMETERS = 2

const GENERIC_TYPE_DECLS = new Set([
  'class_declaration', 'struct_declaration', 'interface_declaration',
  'record_declaration', 'record_struct_declaration', 'delegate_declaration',
])

/**
 * A generic *type* declaring more than `MAX_TYPE_PARAMETERS` type parameters
 * (CA1005). Scoped to type declarations — generic methods are a separate
 * concern and not counted here. The `type_parameter_list` is a direct child of
 * the declaration.
 */
export const csharpTooManyTypeParametersVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-type-parameters',
  languages: ['csharp'],
  nodeTypes: [...GENERIC_TYPE_DECLS],
  visit(node, filePath, sourceCode) {
    const list = node.namedChildren.find((c) => c?.type === 'type_parameter_list')
    if (!list) return null
    const count = list.namedChildren.filter((c) => c?.type === 'type_parameter').length
    if (count <= MAX_TYPE_PARAMETERS) return null

    const name = node.childForFieldName('name')?.text ?? 'type'
    const nameNode: SyntaxNode = node.childForFieldName('name') ?? node
    return makeViolation(
      this.ruleKey, nameNode, filePath, 'low',
      'Too many type parameters',
      `Type \`${name}\` declares ${count} generic type parameters (> ${MAX_TYPE_PARAMETERS}) — that many are hard to track and to instantiate correctly (CA1005).`,
      sourceCode,
      'Reduce the generic parameter count, or split the type so each part carries fewer.',
    )
  },
}
