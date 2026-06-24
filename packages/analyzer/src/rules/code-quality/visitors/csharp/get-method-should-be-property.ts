import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Get-prefixed methods that are framework patterns, never property candidates.
const RESERVED = new Set([
  'GetEnumerator', 'GetHashCode', 'GetType', 'GetAwaiter', 'GetObjectData', 'GetSchema',
])

/**
 * A public, parameterless <c>GetX()</c> whose body just returns a field or property
 * — an idiomatic property in disguise. Exposing it as a property reads naturally and
 * participates in object initializers and data binding. Kept false-positive free by
 * only flagging a trivial expression-bodied accessor (no parameters, no array/Task
 * return, no work in the body); a <c>GetX()</c> that computes or calls out is left
 * alone, and the Get/Set-pair case is handled by prefer-property-over-method.
 */
export const csharpGetMethodShouldBePropertyVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/get-method-should-be-property',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text ?? ''
    if (!name.startsWith('Get') || name.length <= 3 || RESERVED.has(name)) return null
    const modifiers = node.children.filter((c) => c?.type === 'modifier').map((c) => c!.text)
    if (!modifiers.includes('public')) return null
    // Overrides / virtual / abstract members are bound to a base signature that a
    // property cannot match; explicit interface impls (`T IFoo.GetX()`) likewise.
    if (modifiers.some((m) => m === 'override' || m === 'virtual' || m === 'abstract')) return null
    if (name.includes('.')) return null

    const params = node.childForFieldName('parameters')?.namedChildren.filter((c) => c?.type === 'parameter') ?? []
    if (params.length !== 0) return null

    const ret = node.childForFieldName('returns')
    if (!ret || ret.type === 'void_keyword' || ret.text === 'void' || ret.type === 'array_type') return null
    if (/^(Task|ValueTask|IAsyncEnumerable)\b/.test(ret.text)) return null
    if (node.childForFieldName('type_parameters')) return null // generic method

    // Only a trivial property-like accessor: `=> field/property`, no work.
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'arrow_expression_clause') return null
    const expr = body.namedChild(0)
    if (!isSimpleAccess(expr)) return null

    const suffix = name.slice(3)
    const containing = node.parent?.parent
    // A Get/Set pair is the property-pair case, owned by prefer-property-over-method.
    if (hasSetter(containing, suffix)) return null
    // A `GetX()` returning an existing property `X` is the redundancy case, owned by
    // property-matches-get-method — not a "should be a property" candidate.
    if (hasProperty(containing, suffix)) return null

    return makeViolation(
      this.ruleKey, nameNode ?? node, filePath, 'low',
      'Get-prefixed method should be a property',
      `'${name}' is a parameterless accessor that just returns a value — expose it as a property '${name.slice(3)}' instead.`,
      sourceCode,
      `Replace the ${name}() method with a property '${name.slice(3)}'.`,
    )
  },
}

/** A bare field/property read: identifier, this.x, or a member access with no call. */
function isSimpleAccess(node: SyntaxNode | null): boolean {
  if (!node) return false
  if (node.type === 'identifier') return true
  if (node.type === 'member_access_expression') return isSimpleAccess(node.childForFieldName('expression'))
  if (node.type === 'this_expression') return true
  return false
}

function hasSetter(containing: SyntaxNode | null | undefined, suffix: string): boolean {
  const body = containing?.namedChildren.find((c) => c?.type === 'declaration_list')
  if (!body) return false
  return body.namedChildren.some(
    (m) =>
      m?.type === 'method_declaration' &&
      m.childForFieldName('name')?.text === `Set${suffix}` &&
      (m.childForFieldName('parameters')?.namedChildren.filter((c) => c?.type === 'parameter').length ?? 0) === 1,
  )
}

/** True if the containing type already declares a property named <suffix>. */
function hasProperty(containing: SyntaxNode | null | undefined, suffix: string): boolean {
  const body = containing?.namedChildren.find((c) => c?.type === 'declaration_list')
  if (!body) return false
  return body.namedChildren.some(
    (m) => m?.type === 'property_declaration' && m.childForFieldName('name')?.text === suffix,
  )
}
