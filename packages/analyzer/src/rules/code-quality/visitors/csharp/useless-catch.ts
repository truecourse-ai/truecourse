import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { csharpUselessCatch } from './no-useless-catch.js'

export const csharpUselessCatchVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/useless-catch',
  languages: ['csharp'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const useless = csharpUselessCatch(node)
    if (!useless) return null
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Useless catch clause',
      'This catch clause only re-throws the caught exception without adding context. Remove it or add error handling logic.',
      sourceCode,
      'Remove the try/catch wrapper or add meaningful error handling in the catch block.',
    )
  },
}
