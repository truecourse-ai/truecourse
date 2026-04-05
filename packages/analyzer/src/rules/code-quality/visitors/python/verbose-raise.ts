import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function getExceptVar(node: SyntaxNode): string | null {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'except_clause') {
      // Look for as pattern: except SomeException as e
      const asPattern = cur.namedChildren.find((c) => c.type === 'as_pattern')
      if (asPattern) {
        const target = asPattern.namedChildren.find((c) => c.type === 'as_pattern_target')
        if (target) {
          const name = target.namedChildren.find((c) => c.type === 'identifier')
          return name?.text ?? null
        }
        return null
      }
      return null
    }
    if (cur.type === 'function_definition') return null
    cur = cur.parent
  }
  return null
}

export const pythonVerboseRaiseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/verbose-raise',
  languages: ['python'],
  nodeTypes: ['raise_statement'],
  visit(node, filePath, sourceCode) {
    // raise e — where e is the caught exception variable
    const expr = node.namedChildren[0]
    if (!expr || expr.type !== 'identifier') return null

    const excVar = getExceptVar(node)
    if (!excVar || expr.text !== excVar) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Verbose re-raise',
      `\`raise ${excVar}\` resets the traceback. Use bare \`raise\` to preserve the original traceback.`,
      sourceCode,
      'Replace `raise e` with bare `raise` to preserve the original traceback.',
    )
  },
}
