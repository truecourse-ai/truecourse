import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * PYI055: Detects `type[X] | type[Y]` which should be written as `type[X | Y]`.
 * e.g.:
 *   type[int] | type[str]  →  type[int | str]
 */
export const pythonUnnecessaryTypeUnionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-type-union',
  languages: ['python'],
  nodeTypes: ['union_type', 'binary_operator'],
  visit(node, filePath, sourceCode) {
    // Python grammar represents `type[int] | type[str]` as union_type with type > generic_type children
    if (node.type === 'union_type') {
      const members = node.namedChildren
      if (members.length < 2) return null

      function isTypeGeneric(n: typeof members[0]): boolean {
        // Each member is a `type` node wrapping a `generic_type`
        const inner = n.type === 'type' ? n.namedChildren[0] : n
        if (!inner || inner.type !== 'generic_type') return false
        return inner.namedChildren[0]?.text === 'type'
      }

      function getTypeInner(n: typeof members[0]): string {
        const inner = n.type === 'type' ? n.namedChildren[0] : n
        return inner?.namedChildren[1]?.namedChildren[0]?.text ?? '?'
      }

      if (members.every(isTypeGeneric)) {
        const leftInner = getTypeInner(members[0])
        const rightInner = getTypeInner(members[1])
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary type[X] | type[Y] union',
          `\`type[${leftInner}] | type[${rightInner}]\` should be written as \`type[${leftInner} | ${rightInner}]\`.`,
          sourceCode,
          `Replace \`type[${leftInner}] | type[${rightInner}]\` with \`type[${leftInner} | ${rightInner}]\`.`,
        )
      }
      return null
    }

    // Fallback: binary_operator `|` (older grammar / runtime usage)
    if (node.type === 'binary_operator') {
      const op = node.children.find((c) => c.text === '|')
      if (!op) return null

      const left = node.namedChildren[0]
      const right = node.namedChildren[1]
      if (!left || !right) return null

      function isTypeSubscript(n: typeof left): boolean {
        if (n.type !== 'subscript') return false
        const obj = n.childForFieldName('value') ?? n.namedChildren[0]
        return obj?.text === 'type'
      }

      if (isTypeSubscript(left) && isTypeSubscript(right)) {
        const leftInner = (left.childForFieldName('subscript') ?? left.namedChildren[1])?.text ?? '?'
        const rightInner = (right.childForFieldName('subscript') ?? right.namedChildren[1])?.text ?? '?'
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Unnecessary type[X] | type[Y] union',
          `\`type[${leftInner}] | type[${rightInner}]\` should be written as \`type[${leftInner} | ${rightInner}]\`.`,
          sourceCode,
          `Replace \`type[${leftInner}] | type[${rightInner}]\` with \`type[${leftInner} | ${rightInner}]\`.`,
        )
      }
    }

    return null
  },
}
