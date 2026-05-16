import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const tooManyUnionMembersVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-union-members',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['union_type'],
  visit(node, filePath, sourceCode) {
    if (node.parent?.type === 'union_type') return null

    // Skip unions in .d.ts files — these are externally-defined protocol enums
    if (filePath.endsWith('.d.ts')) return null

    // Skip unions inside type arguments (e.g., Pick<T, 'a' | 'b' | 'c'> — key unions, not type unions)
    let ancestor = node.parent
    while (ancestor) {
      if (ancestor.type === 'type_arguments') return null
      if (ancestor.type === 'type_alias_declaration' || ancestor.type === 'interface_declaration') break
      ancestor = ancestor.parent
    }

    function collectMembers(n: SyntaxNode, out: SyntaxNode[]): void {
      if (n.type !== 'union_type') {
        out.push(n)
        return
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) collectMembers(child, out)
      }
    }

    const members: SyntaxNode[] = []
    collectMembers(node, members)

    // Only flag string-literal enum-like unions. Numeric-literal unions
    // (HTTP status codes), primitive/builtin unions (JsonPrimitive-style),
    // and type-reference unions (cross-environment event types) are
    // legitimate domain types — flagging them is noise.
    const isStringLiteralMember = (m: SyntaxNode): boolean => {
      if (m.type !== 'literal_type') return false
      const inner = m.namedChild(0)
      return inner?.type === 'string'
    }
    const allStringLiterals = members.length > 0 && members.every(isStringLiteralMember)
    if (!allStringLiterals) return null

    const memberCount = members.length
    if (memberCount > 5) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many union members',
        `Union type has ${memberCount} members (max 5). Consider using an enum or a type alias for clarity.`,
        sourceCode,
        'Extract the union into a named type alias or use an enum.',
      )
    }
    return null
  },
}
