import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { getCSharpDeclAttributeNames } from './_helpers.js'

/** The argument texts of an `argument_list`. */
function argTexts(argList: SyntaxNode | null | undefined): string[] {
  if (!argList) return []
  return argList.namedChildren.filter((c) => c?.type === 'argument').map((c) => c!.text)
}

/** Parameter names declared by a `parameter_list`, in order. */
function paramNames(node: SyntaxNode): string[] {
  const list = node.namedChildren.find((c) => c?.type === 'parameter_list')
  if (!list) return []
  return list.namedChildren
    .filter((c) => c?.type === 'parameter')
    .map((c) => c!.childForFieldName('name')?.text ?? '')
}

/**
 * An override whose entire body is `base.Member(sameArgs)` (a method) or
 * `base.Member` (a property/indexer getter) adds nothing the base did not
 * already do — the override is pure boilerplate that only obscures the call
 * graph and can be deleted (RCS1132). The forwarded call must target the
 * same member name with arguments that are exactly the override's parameters
 * in order, so an override that reorders, filters, or augments the base call
 * is never flagged. Attributed overrides (e.g. a `[ProducesResponseType]`
 * action) carry behaviour in the attribute and are exempt.
 */
export const csharpRedundantOverrideVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/redundant-override',
  languages: ['csharp'],
  nodeTypes: ['method_declaration', 'property_declaration'],
  visit(node, filePath, sourceCode) {
    if (!hasCSharpModifier(node, 'override')) return null
    if (getCSharpDeclAttributeNames(node).length > 0) return null

    const memberName = node.childForFieldName('name')?.text
    if (!memberName) return null

    if (node.type === 'method_declaration') {
      const call = forwardingExpression(node)
      if (!call || call.type !== 'invocation_expression') return null
      const fn = call.childForFieldName('function')
      if (!isBaseMember(fn, memberName)) return null
      // Arguments must be exactly the parameters, in order.
      const args = argTexts(call.childForFieldName('arguments'))
      const params = paramNames(node)
      if (args.length !== params.length) return null
      if (!args.every((a, i) => a === params[i])) return null
      return report(this.ruleKey, node, filePath, sourceCode, memberName)
    }

    // property_declaration: expression-bodied `=> base.Member` only — a full
    // get/set accessor body is out of scope (it may add real logic).
    const expr = forwardingExpression(node)
    if (!expr) return null
    if (!isBaseMember(expr, memberName)) return null
    return report(this.ruleKey, node, filePath, sourceCode, memberName)
  },
}

/** The single expression of an expression-bodied / single-`return` body. */
function forwardingExpression(node: SyntaxNode): SyntaxNode | null {
  const arrow = node.namedChildren.find((c) => c?.type === 'arrow_expression_clause')
  if (arrow) return arrow.namedChildren.find((c) => c != null) ?? null

  const block = node.namedChildren.find((c) => c?.type === 'block')
  if (!block) return null
  const statements = block.namedChildren.filter((c) => c != null && c.type !== 'comment')
  if (statements.length !== 1) return null
  const only = statements[0]
  if (only?.type !== 'return_statement') return null
  return only.namedChildren.find((c) => c != null) ?? null
}

/** True when `node` is `base.<name>` (member access on `base`). */
function isBaseMember(node: SyntaxNode | null | undefined, name: string): boolean {
  if (node?.type !== 'member_access_expression') return false
  return node.childForFieldName('expression')?.text === 'base' && node.childForFieldName('name')?.text === name
}

function report(ruleKey: string, node: SyntaxNode, filePath: string, sourceCode: string, name: string) {
  return makeViolation(
    ruleKey, node.childForFieldName('name') ?? node, filePath, 'low',
    'Redundant override',
    `\`${name}\` overrides the base member only to forward to it with the same arguments — the override adds nothing and can be removed (RCS1132).`,
    sourceCode,
    'Remove the redundant override.',
  )
}
