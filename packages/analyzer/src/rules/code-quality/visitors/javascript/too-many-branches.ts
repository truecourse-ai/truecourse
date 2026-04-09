import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'
import type { SyntaxNode } from 'tree-sitter'

export const tooManyBranchesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-branches',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    let branchCount = 0
    // Count if_statement and switch_case, but NOT else_clause (it's part of the if, counting both doubles up)
    const BRANCH_TYPES = new Set(['if_statement', 'switch_case'])

    function walk(n: SyntaxNode) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) return
      if (BRANCH_TYPES.has(n.type)) branchCount++
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (branchCount > 10) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Too many branches',
        `Function \`${name}\` has ${branchCount} branches (max 10). Consider using lookup tables or extracting logic.`,
        sourceCode,
        'Reduce branches by extracting logic, using strategy patterns, or lookup tables.',
      )
    }
    return null
  },
}
