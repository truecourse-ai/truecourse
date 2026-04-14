import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * PYI016 / PYI062 / RUF041: Detects duplicate members in Union or Literal types.
 * e.g.:
 *   Union[int, int]      # duplicate
 *   Literal["a", "a"]    # duplicate
 *   int | int            # duplicate PEP 604
 */
export const pythonDuplicateUnionLiteralMemberVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/duplicate-union-literal-member',
  languages: ['python'],
  nodeTypes: ['generic_type', 'union_type', 'binary_operator'],
  visit(node, filePath, sourceCode) {
    // PEP 604 union: int | int (Python grammar parses as binary_operator or union_type)
    if (node.type === 'binary_operator') {
      const op = node.children.find((c) => c.type === '|' || c.text === '|')
      if (!op) return null

      const left = node.namedChildren[0]
      const right = node.namedChildren[1]
      if (left && right && left.text === right.text) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Duplicate union member',
          `\`${left.text}\` appears multiple times in the union type. Remove the duplicate.`,
          sourceCode,
          `Remove the duplicate \`${left.text}\` from the union type.`,
        )
      }
      return null
    }

    // PEP 604 union_type node: int | int
    if (node.type === 'union_type') {
      const members = node.namedChildren
      const seen = new Set<string>()
      for (const m of members) {
        const text = m.text
        if (seen.has(text)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            'Duplicate union member',
            `\`${text}\` appears multiple times in the union type. Remove the duplicate.`,
            sourceCode,
            `Remove the duplicate \`${text}\` from the union type.`,
          )
        }
        seen.add(text)
      }
      return null
    }

    // Union[X, X] or Literal["a", "a"] — Python grammar uses generic_type node
    if (node.type === 'generic_type') {
      const nameNode = node.namedChildren[0]
      if (!nameNode) return null
      const typeName = nameNode.text

      if (typeName !== 'Union' && typeName !== 'Literal' && !typeName.endsWith('.Union') && !typeName.endsWith('.Literal')) {
        return null
      }

      // type_parameter holds the arguments
      const typeParam = node.namedChildren[1]
      if (!typeParam) return null

      // Collect all type arguments (named children of type_parameter)
      const args: string[] = []
      for (const child of typeParam.namedChildren) {
        args.push(child.text)
      }

      const seen = new Set<string>()
      for (const arg of args) {
        if (seen.has(arg)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'low',
            `Duplicate ${typeName} member`,
            `\`${arg}\` appears multiple times in \`${typeName}\`. Remove the duplicate.`,
            sourceCode,
            `Remove the duplicate \`${arg}\` from \`${typeName}\`.`,
          )
        }
        seen.add(arg)
      }
    }

    return null
  },
}
