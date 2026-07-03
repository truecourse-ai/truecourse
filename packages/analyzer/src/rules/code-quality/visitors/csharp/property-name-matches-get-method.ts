import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A type that declares both a property `X` and a parameterless method `GetX()`
 * gives readers two confusingly similar ways to obtain the same value.
 * The check fires on a `property_declaration` named `X` whose enclosing type
 * also declares a method named `GetX` taking no parameters. Fires once per
 * property to avoid double-reporting from the method side.
 */
function enclosingTypeBody(node: SyntaxNode): SyntaxNode | null {
  const body = node.parent
  return body?.type === 'declaration_list' ? body : null
}

/** True when `expr` is a zero-argument call to `GetX` (bare or `this.GetX`). */
function isZeroArgCallTo(expr: SyntaxNode | null | undefined, getName: string): boolean {
  if (expr?.type !== 'invocation_expression') return false
  const fn = expr.childForFieldName('function') ?? expr.namedChildren[0]
  const fnText = fn?.text
  if (fnText !== getName && fnText !== `this.${getName}`) return false
  const args = expr.childForFieldName('arguments') ?? expr.namedChildren.find((c) => c?.type === 'argument_list')
  const argCount = args?.namedChildren.filter((c) => c?.type === 'argument').length ?? 0
  return argCount === 0
}

/**
 * True when the property's getter body is exactly `GetX()` — an expression-bodied
 * property (`=> GetX()`), a `get => GetX()` accessor, or a `get { return GetX(); }`
 * accessor. Such a property *delegates* to the method (one implementation, the
 * idiomatic public surface over a protected/overridable `GetX()`), so it is not a
 * confusing duplicate.
 */
function getterDelegatesTo(prop: SyntaxNode, getName: string): boolean {
  // Expression-bodied property: `T X => GetX();`
  const propArrow = prop.namedChildren.find((c) => c?.type === 'arrow_expression_clause')
  if (propArrow) return isZeroArgCallTo(propArrow.namedChildren.find(Boolean), getName)

  const accessorList = prop.namedChildren.find((c) => c?.type === 'accessor_list')
  if (!accessorList) return false
  const getter = accessorList.namedChildren.find(
    (a) => a?.type === 'accessor_declaration' && a.children.some((c) => c?.text === 'get'),
  )
  if (!getter) return false

  // `get => GetX();`
  const getArrow = getter.namedChildren.find((c) => c?.type === 'arrow_expression_clause')
  if (getArrow) return isZeroArgCallTo(getArrow.namedChildren.find(Boolean), getName)

  // `get { return GetX(); }`
  const block = getter.namedChildren.find((c) => c?.type === 'block')
  if (block) {
    const stmts = block.namedChildren.filter((c) => c?.type !== 'comment')
    if (stmts.length === 1 && stmts[0]?.type === 'return_statement') {
      return isZeroArgCallTo(stmts[0].namedChildren.find(Boolean), getName)
    }
  }
  return false
}

export const csharpPropertyNameMatchesGetMethodVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/property-name-matches-get-method',
  languages: ['csharp'],
  nodeTypes: ['property_declaration'],
  visit(node, filePath, sourceCode) {
    const propName = node.childForFieldName('name')?.text
    if (!propName) return null

    const body = enclosingTypeBody(node)
    if (!body) return null

    const target = `Get${propName}`
    const hasGetMethod = body.namedChildren.some((member) => {
      if (member?.type !== 'method_declaration') return false
      if (member.childForFieldName('name')?.text !== target) return false
      const params = member.childForFieldName('parameters')
      return (params?.namedChildren.filter((c) => c?.type === 'parameter').length ?? 0) === 0
    })
    if (!hasGetMethod) return null

    // A property whose getter body is exactly `GetX()` delegates to the method —
    // a single implementation exposed through the property, not a duplicate. This
    // is the idiomatic "public property surface over a protected/overridable
    // `GetX()`" pattern, so it must not fire.
    if (getterDelegatesTo(node, target)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Property name matches a Get method',
      `Property \`${propName}\` coexists with a parameterless \`${target}()\` method — a confusing duplication of how the value is exposed.`,
      sourceCode,
      `Keep one accessor: either the property \`${propName}\` or the method \`${target}\`, not both.`,
    )
  },
}
