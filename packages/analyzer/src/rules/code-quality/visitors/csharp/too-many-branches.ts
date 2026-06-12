import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_TYPES, getCSharpFunctionBody, getCSharpFunctionName, isCSharpFunctionBoundary } from './_helpers.js'

export const csharpTooManyBranchesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-branches',
  languages: ['csharp'],
  nodeTypes: CSHARP_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getCSharpFunctionBody(node)
    if (!bodyNode) return null

    let branchCount = 0

    function walk(n: SyntaxNode) {
      if (isCSharpFunctionBoundary(n.type) && n.id !== node.id) return
      if (n.type === 'if_statement') branchCount++
      // Each `case …:` section is a branch. `default:` and switch-expression
      // arms (declarative pattern matching) are not counted.
      if (n.type === 'switch_section' && n.children.some((c) => c?.type === 'case')) branchCount++
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (branchCount > 10) {
      const name = getCSharpFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Too many branches',
        `Method \`${name}\` has ${branchCount} branches (max 10). Consider using lookup tables or extracting logic.`,
        sourceCode,
        'Reduce branches by extracting logic, using strategy patterns, or lookup tables.',
      )
    }
    return null
  },
}
