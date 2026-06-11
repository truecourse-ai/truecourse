import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { csharpRepeatedStringCandidate } from './magic-string.js'

export const csharpDuplicateStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/duplicate-string',
  languages: ['csharp'],
  nodeTypes: ['compilation_unit'],
  visit(node, filePath, sourceCode) {
    const stringCounts = new Map<string, { count: number; firstNode: SyntaxNode }>()

    function walk(n: SyntaxNode) {
      const inner = csharpRepeatedStringCandidate(n)
      if (inner !== null && inner.length > 3) {
        const existing = stringCounts.get(inner)
        if (existing) existing.count++
        else stringCounts.set(inner, { count: 1, firstNode: n })
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) walk(child)
      }
    }

    walk(node)

    for (const [content, info] of stringCounts) {
      if (info.count >= 3) {
        return makeViolation(
          this.ruleKey, info.firstNode, filePath, 'low',
          'Duplicate string literal',
          `String "${content}" appears ${info.count} times. Extract to a named constant.`,
          sourceCode,
          'Extract the repeated string into a const field.',
        )
      }
    }
    return null
  },
}
