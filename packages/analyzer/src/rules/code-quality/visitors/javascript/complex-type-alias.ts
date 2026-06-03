import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// `A | B | C | D` parses as a left-leaning chain of nested union_types in
// tree-sitter-typescript, not a flat list. Flatten the chain so we can
// classify each member directly. Skip `comment` and `ERROR` nodes —
// per-member trailing comments and leading-`|` artefacts otherwise leak
// into the member list and defeat the simple-union check.
const NON_MEMBER_NODE_TYPES = new Set(['comment', 'ERROR', 'MISSING'])
function flattenUnionMembers(node: SyntaxNode): SyntaxNode[] {
  if (node.type !== 'union_type') return [node]
  const out: SyntaxNode[] = []
  for (const child of node.namedChildren) {
    if (NON_MEMBER_NODE_TYPES.has(child.type)) continue
    if (child.type === 'union_type') out.push(...flattenUnionMembers(child))
    else out.push(child)
  }
  return out
}

// Idiomatic utility-type chains like
// `NonNullable<Awaited<ReturnType<typeof method>>>` or
// `Prettify<NonNullable<Awaited<ReturnType<...>>>>` are the canonical
// way to derive a result type from an async method. They're read as a
// single unit, not parsed structurally, so the bracket-depth heuristic
// over-flags them.
const UTILITY_TYPE_NAMES = new Set([
  'Awaited', 'ReturnType', 'Parameters', 'ConstructorParameters',
  'InstanceType', 'NonNullable', 'Required', 'Partial', 'Readonly',
  'Pick', 'Omit', 'Exclude', 'Extract',
  'Prettify', 'Simplify', 'Expand', 'DeepReadonly', 'DeepPartial',
])
function isUtilityTypeChain(node: SyntaxNode): boolean {
  let cur: SyntaxNode | null = node
  // Walk a generic-type chain: each level must be `<UtilityName><...>`
  // and its single type argument is the next link. Bottoms out in a
  // simple `typeof X`, `type_identifier`, or member/index lookup.
  while (cur) {
    if (cur.type !== 'generic_type') return false
    const name = cur.childForFieldName('name') ?? cur.namedChildren[0]
    if (!name || name.type !== 'type_identifier') return false
    if (!UTILITY_TYPE_NAMES.has(name.text)) return false
    const args: SyntaxNode | null = cur.childForFieldName('type_arguments') ?? cur.namedChildren[1] ?? null
    if (!args) return false
    const typeArgs: SyntaxNode[] = args.namedChildren.filter((c: SyntaxNode) => !NON_MEMBER_NODE_TYPES.has(c.type))
    if (typeArgs.length !== 1) return false
    const inner: SyntaxNode = typeArgs[0]!
    if (inner.type === 'generic_type') {
      cur = inner
      continue
    }
    // Leaf: must be a simple reference, not a nested complex type.
    return (
      inner.type === 'type_identifier' ||
      inner.type === 'predefined_type' ||
      inner.type === 'type_query' ||
      inner.type === 'literal_type'
    )
  }
  return false
}

const SIMPLE_UNION_MEMBER_TYPES = new Set([
  'literal_type',
  'string',
  'number',
  'type_identifier',
  'predefined_type',
  'null',
  'undefined',
])

/**
 * Detects type aliases or inline types with very deep nesting (count depth of
 * nested <> and []).  When the nesting depth exceeds a threshold (4), flag it
 * as overly complex.
 */

function maxBracketDepth(text: string): number {
  let depth = 0
  let max = 0
  for (const ch of text) {
    if (ch === '<' || ch === '[') {
      depth++
      if (depth > max) max = depth
    } else if (ch === '>' || ch === ']') {
      depth = Math.max(0, depth - 1)
    }
  }
  return max
}

function countUnionIntersectionMembers(text: string): number {
  // Count top-level | and & operators (rough heuristic)
  let depth = 0
  let count = 1
  for (const ch of text) {
    if (ch === '<' || ch === '[' || ch === '(' || ch === '{') depth++
    else if (ch === '>' || ch === ']' || ch === ')' || ch === '}') depth--
    else if (depth === 0 && (ch === '|' || ch === '&')) count++
  }
  return count
}

const DEPTH_THRESHOLD = 4
const MEMBER_THRESHOLD = 6

export const complexTypeAliasVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/complex-type-alias',
  languages: ['typescript'],
  nodeTypes: ['type_alias_declaration'],
  visit(node, filePath, sourceCode) {
    const typeValue = node.childForFieldName('value')
    if (!typeValue) return null

    const typeText = typeValue.text
    const depth = maxBracketDepth(typeText)
    const members = countUnionIntersectionMembers(typeText)

    // Skip union types whose members are all "simple": string/number/boolean
    // literals (discriminated unions), single named type references
    // (`TFoo | TBar | TBaz` enumerating subtypes), or predefined primitives.
    // Long-but-flat unions of named subtypes are documentation, not
    // complexity worth flagging.
    if (typeValue.type === 'union_type') {
      const members = flattenUnionMembers(typeValue)
      const allSimple = members.every((m) => SIMPLE_UNION_MEMBER_TYPES.has(m.type))
      if (allSimple) return null
    }

    // Skip idiomatic utility-type chains regardless of nesting depth.
    if (typeValue.type === 'generic_type' && isUtilityTypeChain(typeValue)) return null

    if (depth >= DEPTH_THRESHOLD || members >= MEMBER_THRESHOLD) {
      const reason = depth >= DEPTH_THRESHOLD
        ? `nesting depth of ${depth} (threshold: ${DEPTH_THRESHOLD})`
        : `${members} union/intersection members (threshold: ${MEMBER_THRESHOLD})`
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Complex type alias',
        `Type alias has ${reason}. Break it into smaller named types for readability.`,
        sourceCode,
        'Extract intermediate type aliases to reduce complexity.',
      )
    }

    return null
  },
}
