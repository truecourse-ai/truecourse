import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Assigning with `as` and then testing the result for null performs the type
 * test in two steps that can drift apart; the `is`-pattern does the check and
 * the binding in one expression and cannot be left half-applied (RCS1172):
 *
 *   var t = obj as T;        →    if (obj is T t) { … }
 *   if (t != null) { … }
 *
 * The check fires on a `local_declaration_statement` declaring a single
 * variable from an `as_expression` whose *immediately following* statement is
 * an `if` whose condition is exactly `<that variable> != null`. Requiring
 * adjacency and a bare `!= null` condition keeps the pattern unambiguous — any
 * use of the variable between the declaration and the check, or a compound
 * condition, means the straightforward rewrite no longer applies.
 */

function singleAsDeclarator(stmt: SyntaxNode): { name: string; asExpr: SyntaxNode } | null {
  const decl = stmt.namedChildren.find((c) => c?.type === 'variable_declaration')
  if (!decl) return null
  const declarators = decl.namedChildren.filter((c) => c?.type === 'variable_declarator')
  if (declarators.length !== 1) return null
  const declarator = declarators[0]!
  const value = declarator.namedChildren.find((c) => c?.type !== 'identifier')
  if (value?.type !== 'as_expression') return null
  const name = (declarator.childForFieldName('name') ?? declarator.namedChildren[0])?.text
  if (!name) return null
  return { name, asExpr: value }
}

function isNotNullCheckOf(ifStmt: SyntaxNode, name: string): boolean {
  if (ifStmt.type !== 'if_statement') return false
  const cond = ifStmt.childForFieldName('condition')
  if (cond?.type !== 'binary_expression') return false
  if (cond.childForFieldName('operator')?.text !== '!=') return false
  const left = cond.childForFieldName('left')
  const right = cond.childForFieldName('right')
  return left?.type === 'identifier' && left.text === name && right?.type === 'null_literal'
}

export const csharpUseIsOverAsNullCheckVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/use-is-over-as-null-check',
  languages: ['csharp'],
  nodeTypes: ['local_declaration_statement'],
  visit(node, filePath, sourceCode) {
    const decl = singleAsDeclarator(node)
    if (!decl) return null

    let next = node.nextNamedSibling
    while (next && next.type === 'comment') next = next.nextNamedSibling
    if (!next || !isNotNullCheckOf(next, decl.name)) return null

    const operand = decl.asExpr.childForFieldName('left')?.text ?? 'obj'
    const type = decl.asExpr.childForFieldName('right')?.text ?? 'T'
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use the is operator instead of as followed by a null check',
      `\`${decl.name} = ${operand} as ${type}\` followed by \`${decl.name} != null\` tests the type twice in spirit; \`${operand} is ${type} ${decl.name}\` does the check and binding in one step (RCS1172).`,
      sourceCode,
      `Replace the \`as\` + null-check with \`if (${operand} is ${type} ${decl.name})\`.`,
    )
  },
}
