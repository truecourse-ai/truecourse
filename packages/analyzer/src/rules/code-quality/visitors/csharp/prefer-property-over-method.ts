import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Parameterless Get* methods that are framework patterns, not property candidates.
const RESERVED_GETTERS = new Set([
  'GetEnumerator', 'GetHashCode', 'GetType', 'GetAwaiter', 'GetObjectData', 'GetSchema',
])

/**
 * A `GetX()`/`SetX(value)` method pair that should be a property `X`. The getter
 * takes no parameters and returns a value; the setter takes a single argument and
 * returns void. Exposing the pair as a property reads more naturally and lets the
 * value participate in object initializers and data binding. Only flagged when both
 * halves are present, so a lone `GetX()` (which may be an expensive computation,
 * not a property) is left alone.
 */
export const csharpPreferPropertyOverMethodVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/prefer-property-over-method',
  languages: ['csharp'],
  nodeTypes: ['method_declaration'],
  visit(node, filePath, sourceCode) {
    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text ?? ''
    if (!name.startsWith('Get') || name.length <= 3 || RESERVED_GETTERS.has(name)) return null

    // Getter shape: no parameters, non-void return.
    const params = node.childForFieldName('parameters')?.namedChildren.filter((c) => c?.type === 'parameter') ?? []
    if (params.length !== 0) return null
    if (node.childForFieldName('returns')?.text === 'void') return null

    const suffix = name.slice(3)
    const containing = node.parent?.parent
    if (!containing) return null
    if (!hasSetter(containing, suffix)) return null

    return makeViolation(
      this.ruleKey, nameNode ?? node, filePath, 'low',
      'Get/Set method pair should be a property',
      `'${name}'/'Set${suffix}' should be exposed as a property '${suffix}' instead of a Get/Set method pair.`,
      sourceCode,
      `Replace the Get${suffix}/Set${suffix} pair with a property '${suffix}'.`,
    )
  },
}

/** True if the containing type declares a `Set<suffix>(value)` taking one parameter. */
function hasSetter(containing: SyntaxNode, suffix: string): boolean {
  const body = containing.namedChildren.find((c) => c?.type === 'declaration_list')
  if (!body) return false
  for (const member of body.namedChildren) {
    if (member?.type !== 'method_declaration') continue
    if (member.childForFieldName('name')?.text !== `Set${suffix}`) continue
    const setParams = member.childForFieldName('parameters')?.namedChildren.filter((c) => c?.type === 'parameter') ?? []
    if (setParams.length === 1) return true
  }
  return false
}
