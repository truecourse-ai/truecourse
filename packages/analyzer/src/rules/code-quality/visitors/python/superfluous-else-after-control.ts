import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

const CONTROL_FLOW_TYPES = new Set(['return_statement', 'raise_statement', 'break_statement', 'continue_statement'])

function bodyEndsWithControlFlow(bodyNode: SyntaxNode): string | null {
  const stmts = bodyNode.namedChildren
  if (stmts.length === 0) return null
  const last = stmts[stmts.length - 1]
  if (CONTROL_FLOW_TYPES.has(last.type)) {
    return last.type.replace('_statement', '')
  }
  return null
}

export const pythonSuperfluousElseAfterControlVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/superfluous-else-after-control',
  languages: ['python'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    // Get the if body and else clause
    const consequent = node.childForFieldName('consequence')
    const alternative = node.namedChildren.find((c) => c.type === 'else_clause' || c.type === 'elif_clause')

    if (!consequent || !alternative) return null
    if (alternative.type === 'elif_clause') return null // only check else, not elif

    const controlFlow = bodyEndsWithControlFlow(consequent)
    if (!controlFlow) return null

    return makeViolation(
      this.ruleKey, alternative, filePath, 'low',
      `Superfluous else after ${controlFlow}`,
      `\`else\` block after \`${controlFlow}\` is unnecessary — the code can be de-indented.`,
      sourceCode,
      'Remove the `else` keyword and de-indent the block.',
    )
  },
}
