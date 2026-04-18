import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

export const pythonCyclomaticComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/cyclomatic-complexity',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const bodyNode = node.childForFieldName('body')
    if (!bodyNode) return null

    let complexity = 1
    const DECISION_TYPES = new Set(['if_statement', 'for_statement', 'while_statement', 'except_clause'])

    function walk(n: SyntaxNode) {
      if (n.type === 'function_definition' && n.id !== node.id) return
      if (DECISION_TYPES.has(n.type)) complexity++
      if (n.type === 'elif_clause') complexity++
      if (n.type === 'boolean_operator') complexity++
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(bodyNode)

    if (complexity > 10) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'anonymous'
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'High cyclomatic complexity',
        `Function \`${name}\` has cyclomatic complexity ${complexity} (max 10). Consider splitting into smaller functions.`,
        sourceCode,
        'Reduce decision points by extracting logic into helper functions.',
      )
    }
    return null
  },
}
