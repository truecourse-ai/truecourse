import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonAssertWithPrintMessageVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/assert-with-print-message',
  languages: ['python'],
  nodeTypes: ['assert_statement'],
  visit(node, filePath, sourceCode) {
    // assert_statement: assert <test> [, <message>]
    // namedChildren[1] is the message expression
    const messageExpr = node.namedChildren[1]
    if (!messageExpr) return null

    if (messageExpr.type === 'call') {
      const fn = messageExpr.childForFieldName('function')
      if (fn?.type === 'identifier' && fn.text === 'print') {
        return makeViolation(
          this.ruleKey, messageExpr, filePath, 'medium',
          'Assert with print() as message',
          `\`assert ..., print("...")\` — \`print()\` executes unconditionally (even when the assertion passes) and returns \`None\`, so the assert message is always \`None\`.`,
          sourceCode,
          'Pass a string literal as the assert message: `assert condition, "error message"`.',
        )
      }
    }
    return null
  },
}
