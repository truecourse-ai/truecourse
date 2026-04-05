import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonIfElseDictLookupVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/if-else-dict-lookup',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Detect long if-elif chains that map a variable to values
    const elifClauses = node.namedChildren.filter((c) => c.type === 'elif_clause')
    if (elifClauses.length < 3) return null // Need at least 4+ branches to warrant a dict

    const elseClause = node.namedChildren.find((c) => c.type === 'else_clause')

    // Check all branches assign to the same variable
    function getSingleAssignmentTarget(body: import('tree-sitter').SyntaxNode): string | null {
      const stmts = body.namedChildren
      if (stmts.length !== 1 || stmts[0].type !== 'assignment') return null
      return stmts[0].childForFieldName('left')?.text ?? null
    }

    const mainBody = node.childForFieldName('consequence')
    if (!mainBody) return null
    const mainTarget = getSingleAssignmentTarget(mainBody)
    if (!mainTarget) return null

    // Check all elif bodies have same target
    for (const elif of elifClauses) {
      const body = elif.namedChildren.find((c) => c.type === 'block')
      if (!body) return null
      const target = getSingleAssignmentTarget(body)
      if (target !== mainTarget) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'if-elif chain as dict lookup',
      `Long if-elif chain assigning to \`${mainTarget}\` can be replaced with a dictionary lookup for clarity.`,
      sourceCode,
      `Replace with a dictionary: \`${mainTarget} = { ... }[key]\` or \`${mainTarget} = { ... }.get(key, default)\`.`,
    )
  },
}
