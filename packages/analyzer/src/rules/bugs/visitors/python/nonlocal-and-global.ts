import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonNonlocalAndGlobalVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/nonlocal-and-global',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const globalVars = new Set<string>()
    const nonlocalVars = new Set<string>()

    for (const stmt of body.namedChildren) {
      if (stmt.type === 'global_statement') {
        for (const child of stmt.namedChildren) {
          if (child.type === 'identifier') globalVars.add(child.text)
        }
      }
      if (stmt.type === 'nonlocal_statement') {
        for (const child of stmt.namedChildren) {
          if (child.type === 'identifier') nonlocalVars.add(child.text)
        }
      }
    }

    for (const varName of nonlocalVars) {
      if (globalVars.has(varName)) {
        // Find the nonlocal statement to report on it
        const nonlocalStmt = body.namedChildren.find((s) =>
          s.type === 'nonlocal_statement' && s.namedChildren.some((c) => c.text === varName)
        )
        return makeViolation(
          this.ruleKey, nonlocalStmt ?? node, filePath, 'critical',
          'nonlocal and global for same variable',
          `\`${varName}\` is declared as both \`nonlocal\` and \`global\` in the same function — this is a SyntaxError.`,
          sourceCode,
          'Use either `global` or `nonlocal`, not both.',
        )
      }
    }
    return null
  },
}
