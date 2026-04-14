import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects yield/return statements outside functions, or break/continue outside loops.
 * These are SyntaxErrors at runtime.
 */
export const pythonYieldReturnOutsideFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/yield-return-outside-function',
  languages: ['python'],
  nodeTypes: ['return_statement', 'yield', 'break_statement', 'continue_statement'],
  visit(node, filePath, sourceCode) {
    const stmtType = node.type

    if (stmtType === 'return_statement' || stmtType === 'yield') {
      // These must be inside a function
      let parent = node.parent
      while (parent) {
        if (parent.type === 'function_definition' || parent.type === 'lambda') {
          return null // OK, inside a function
        }
        if (parent.type === 'module') break
        parent = parent.parent
      }

      const label = stmtType === 'return_statement' ? 'return' : 'yield'
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        `\`${label}\` outside function`,
        `\`${label}\` statement is used outside a function — this causes a \`SyntaxError\` at runtime.`,
        sourceCode,
        `Move the \`${label}\` statement inside a function definition.`,
      )
    }

    if (stmtType === 'break_statement' || stmtType === 'continue_statement') {
      // These must be inside a loop
      let parent = node.parent
      while (parent) {
        if (
          parent.type === 'for_statement' ||
          parent.type === 'while_statement'
        ) {
          return null // OK, inside a loop
        }
        if (
          parent.type === 'function_definition' ||
          parent.type === 'class_definition' ||
          parent.type === 'module'
        ) break
        parent = parent.parent
      }

      const label = stmtType === 'break_statement' ? 'break' : 'continue'
      return makeViolation(
        this.ruleKey, node, filePath, 'critical',
        `\`${label}\` outside loop`,
        `\`${label}\` statement is used outside a loop — this causes a \`SyntaxError\` at runtime.`,
        sourceCode,
        `Move the \`${label}\` statement inside a \`for\` or \`while\` loop.`,
      )
    }

    return null
  },
}
