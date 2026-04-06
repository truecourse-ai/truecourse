import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSwapVariablesPythonicVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/swap-variables-pythonic',
  languages: ['python'],
  nodeTypes: ['block', 'module'],
  visit(node, filePath, sourceCode) {
    const stmts = node.namedChildren

    for (let i = 0; i < stmts.length - 2; i++) {
      const s1 = stmts[i]
      const s2 = stmts[i + 1]
      const s3 = stmts[i + 2]

      // Pattern: tmp = a; a = b; b = tmp
      if (
        s1.type !== 'expression_statement' ||
        s2.type !== 'expression_statement' ||
        s3.type !== 'expression_statement'
      ) continue

      const a1 = s1.namedChildren[0]
      const a2 = s2.namedChildren[0]
      const a3 = s3.namedChildren[0]

      if (!a1 || !a2 || !a3) continue
      if (a1.type !== 'assignment' || a2.type !== 'assignment' || a3.type !== 'assignment') continue

      const tmp = a1.childForFieldName('left')?.text
      const tmpVal = a1.childForFieldName('right')?.text

      const var1 = a2.childForFieldName('left')?.text
      const var2src = a2.childForFieldName('right')?.text

      const var2 = a3.childForFieldName('left')?.text
      const tmpRef = a3.childForFieldName('right')?.text

      if (!tmp || !tmpVal || !var1 || !var2src || !var2 || !tmpRef) continue

      // tmp = a; var1 = var2src; var2 = tmp
      if (tmpVal === var1 && var2 === var2src && tmpRef === tmp && var1 !== var2src) {
        return makeViolation(
          this.ruleKey, s1, filePath, 'low',
          'Non-pythonic variable swap',
          `Use tuple unpacking \`${var1}, ${var2src} = ${var2src}, ${var1}\` instead of a temporary variable.`,
          sourceCode,
          `Replace the 3-line swap with: \`${var1}, ${var2src} = ${var2src}, ${var1}\``,
        )
      }
    }

    return null
  },
}
