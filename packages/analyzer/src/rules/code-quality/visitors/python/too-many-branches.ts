import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

export const pythonTooManyBranchesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-branches',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    let branchCount = 0
    // Count if_statement and elif_clause, but NOT else_clause (part of the if, counting both doubles up)
    const BRANCH_TYPES = new Set(['if_statement', 'elif_clause'])

    function walk(n: SyntaxNode) {
      if (n.type === 'function_definition' && n.id !== node.id) return
      if (BRANCH_TYPES.has(n.type)) branchCount++
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (branchCount > 10) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Too many branches',
        `Function \`${name}\` has ${branchCount} branches (max 10). Consider using lookup tables or extracting logic.`,
        sourceCode,
        'Reduce branches by extracting logic or using dictionaries for dispatch.',
      )
    }
    return null
  },
}
