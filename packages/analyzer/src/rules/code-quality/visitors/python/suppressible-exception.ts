import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSuppressibleExceptionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/suppressible-exception',
  languages: ['python'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    // Find except clauses with only pass
    for (const child of node.namedChildren) {
      if (child.type !== 'except_clause') continue
      const body = child.namedChildren.find((c) => c.type === 'block')
      if (!body) continue
      const stmts = body.namedChildren
      if (stmts.length !== 1 || stmts[0].type !== 'pass_statement') continue

      // Get the exception type
      const excTypes = child.namedChildren.filter((c) => c.type !== 'block' && c.type !== 'as_pattern')
      const excText = excTypes.map((e) => e.text).join(', ') || 'Exception'

      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Suppressible exception',
        `\`try/except ${excText}: pass\` can be replaced with \`contextlib.suppress(${excText})\`.`,
        sourceCode,
        `Replace with \`with contextlib.suppress(${excText}):\`.`,
      )
    }
    return null
  },
}
