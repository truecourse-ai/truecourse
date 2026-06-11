import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// `return` is intentionally excluded — the C# unnecessary-else-after-return
// visitor owns that shape; firing both keys on one `else` would double-report.
const CONTROL_FLOW_TYPES = new Set(['throw_statement', 'break_statement', 'continue_statement'])

function endingControlFlow(body: SyntaxNode): string | null {
  let last: SyntaxNode | null = body
  if (body.type === 'block') {
    const stmts = body.namedChildren.filter(Boolean)
    last = stmts[stmts.length - 1] ?? null
  }
  if (last && CONTROL_FLOW_TYPES.has(last.type)) {
    return last.type.replace('_statement', '')
  }
  return null
}

export const csharpSuperfluousElseAfterControlVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/superfluous-else-after-control',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const consequence = node.childForFieldName('consequence')
    const alternative = node.childForFieldName('alternative')
    if (!consequence || !alternative) return null

    // `else if` chains are a single dispatch construct, not removable elses.
    if (alternative.type === 'if_statement') return null

    const controlFlow = endingControlFlow(consequence)
    if (!controlFlow) return null

    return makeViolation(
      this.ruleKey, alternative, filePath, 'low',
      `Superfluous else after ${controlFlow}`,
      `The \`else\` block after \`${controlFlow}\` is unnecessary — the if branch never falls through, so the else body can be de-indented.`,
      sourceCode,
      'Remove the `else` wrapper and de-indent its body to the outer scope.',
    )
  },
}
