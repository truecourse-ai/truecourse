import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { getCSharpFunctionName, isCSharpNoOpCallbackPosition } from './_helpers.js'

/**
 * Shared "is this an intentionally empty body" check for the two
 * empty-function rules.
 */
export function csharpEmptyBodyIsIntentional(node: SyntaxNode, body: SyntaxNode): boolean {
  // A comment inside the braces documents the emptiness.
  for (let i = 0; i < body.childCount; i++) {
    if (body.child(i)?.type === 'comment') return true
  }
  // No-op lambdas in callback positions are deliberate placeholders.
  if (isCSharpNoOpCallbackPosition(node)) return true
  // `virtual`/`override` empty methods are template-method hooks or
  // intentional suppression of inherited behavior; `partial` methods may be
  // filled in by a generator.
  if (node.type === 'method_declaration') {
    if (hasCSharpModifier(node, 'virtual') || hasCSharpModifier(node, 'override')
      || hasCSharpModifier(node, 'partial')) return true
  }
  if (node.type === 'constructor_declaration') {
    // `: base(...)` / `: this(...)` initializers do the real work.
    if (node.namedChildren.some((c) => c?.type === 'constructor_initializer')) return true
    // Empty private/protected parameterless constructors are the standard
    // EF Core / serializer / singleton pattern.
    // A parameterless empty constructor is never this rule's concern:
    // private/protected ones are the EF/serializer pattern, a public one
    // alongside other constructors is the deserializer hook, and a lone
    // public one is useless-constructor's finding (not "missing logic").
    const params = node.childForFieldName('parameters')
    if (!params || params.namedChildCount === 0) return true
  }
  return false
}

export const csharpEmptyFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/empty-function',
  languages: ['csharp'],
  nodeTypes: ['method_declaration', 'local_function_statement', 'lambda_expression', 'anonymous_method_expression'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
      ?? node.namedChildren.find((c) => c?.type === 'block')
    if (!body || body.type !== 'block') return null
    if (body.namedChildCount > 0) return null

    if (csharpEmptyBodyIsIntentional(node, body)) return null

    const name = getCSharpFunctionName(node)
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Empty method body',
      `Method \`${name}\` has an empty body — add an implementation or remove it.`,
      sourceCode,
      'Add an implementation or remove the empty method.',
    )
  },
}
