import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES } from './_helpers.js'

/**
 * Well-known framework exceptions that are inappropriate to throw from a
 * property getter (CA1065). The getter allow-list — InvalidOperationException
 * and its derivations (e.g. ObjectDisposedException), NotSupportedException,
 * NotImplementedException — is deliberately excluded, as are unknown/custom
 * exception types (which may derive from an allowed base; flagging them without
 * type info would be a false positive).
 */
const DISALLOWED_GETTER_EXCEPTIONS = new Set([
  'Exception',
  'SystemException',
  'ApplicationException',
  'ArgumentException',
  'ArgumentNullException',
  'ArgumentOutOfRangeException',
  'NullReferenceException',
  'FormatException',
  'KeyNotFoundException',
  'InvalidCastException',
  'OverflowException',
  'IndexOutOfRangeException',
  'TimeoutException',
])

/** Right-most simple name of a constructed exception type. */
function createdTypeName(creation: SyntaxNode): string {
  const type = creation.namedChildren.find(
    (c) => c?.type === 'qualified_name' || c?.type === 'identifier' || c?.type === 'generic_name',
  )
  if (!type) return ''
  const text = type.type === 'generic_name' ? (type.childForFieldName('name')?.text ?? type.text) : type.text
  return text.includes('.') ? text.slice(text.lastIndexOf('.') + 1) : text
}

/** First `throw new <DisallowedException>(...)` reachable in the getter body. */
function findDisallowedThrow(node: SyntaxNode): { node: SyntaxNode; name: string } | null {
  if (node.type === 'throw_statement' || node.type === 'throw_expression') {
    const creation = node.namedChildren.find((c) => c?.type === 'object_creation_expression')
    if (creation) {
      const name = createdTypeName(creation)
      if (DISALLOWED_GETTER_EXCEPTIONS.has(name)) return { node, name }
    }
    return null
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child || CSHARP_FUNCTION_BOUNDARIES.has(child.type)) continue
    const found = findDisallowedThrow(child)
    if (found) return found
  }
  return null
}

/** The `get` accessor of a property, whether block- or expression-bodied. */
function getterAccessor(accessorList: SyntaxNode): SyntaxNode | null {
  for (const acc of accessorList.namedChildren) {
    if (acc?.type !== 'accessor_declaration') continue
    const keyword = acc.children.find((c) => c?.type === 'get')
    if (keyword) return acc
  }
  return null
}

/**
 * A property getter that throws an inappropriate exception. Reading a property
 * is expected to be cheap and safe — callers in interpolation, debuggers,
 * serializers, and data binding read getters speculatively and don't guard them
 * with try/catch. A getter may signal an object-state problem with
 * `InvalidOperationException` (or `NotSupportedException`/`NotImplementedException`),
 * but throwing a general-purpose exception (`Exception`, `ArgumentException`,
 * `KeyNotFoundException`, …) breaks that expectation (CA1065).
 */
export const csharpExceptionFromPropertyGetterVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/exception-from-property-getter',
  languages: ['csharp'],
  nodeTypes: ['property_declaration'],
  visit(node, filePath, sourceCode) {
    const accessorList = node.namedChildren.find((c) => c?.type === 'accessor_list')

    let getterBody: SyntaxNode | null = null
    if (accessorList) {
      const getter = getterAccessor(accessorList)
      if (!getter) return null
      getterBody =
        getter.namedChildren.find((c) => c?.type === 'block' || c?.type === 'arrow_expression_clause') ?? null
    } else {
      // Expression-bodied property: `public int X => …;` is a getter.
      getterBody = node.namedChildren.find((c) => c?.type === 'arrow_expression_clause') ?? null
    }
    if (!getterBody) return null

    const hit = findDisallowedThrow(getterBody)
    if (!hit) return null

    return makeViolation(
      this.ruleKey, hit.node, filePath, 'medium',
      'Property getter throws an exception',
      `This getter throws \`${hit.name}\`. Reading a property is expected to be safe; callers (interpolation, debuggers, serializers) don't guard getters, so a general-purpose exception breaks them.`,
      sourceCode,
      'Return a value instead of throwing, or convert the property to a method if the operation can genuinely fail. State checks may use `InvalidOperationException`.',
    )
  },
}
