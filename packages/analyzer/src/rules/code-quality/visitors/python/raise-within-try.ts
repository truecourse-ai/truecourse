import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

function getExceptTypes(tryNode: SyntaxNode): Set<string> {
  const types = new Set<string>()
  for (const child of tryNode.namedChildren) {
    if (child.type !== 'except_clause') continue
    for (const c of child.namedChildren) {
      if (c.type !== 'block' && c.type !== 'as_pattern') {
        types.add(c.text.split('(')[0].trim())
      }
    }
  }
  return types
}

function getRaisedType(raiseNode: SyntaxNode): string | null {
  const expr = raiseNode.namedChildren[0]
  if (!expr) return null
  if (expr.type === 'call') {
    const fn = expr.childForFieldName('function')
    return fn?.text ?? null
  }
  if (expr.type === 'identifier') return expr.text
  return null
}

export const pythonRaiseWithinTryVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/raise-within-try',
  languages: ['python'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    const tryBody = node.childForFieldName('body')
    if (!tryBody) return null

    const exceptTypes = getExceptTypes(node)
    if (exceptTypes.size === 0) return null

    // Look for raise statements in the try body that match caught exceptions
    for (const stmt of tryBody.namedChildren) {
      if (stmt.type !== 'raise_statement') continue
      const raisedType = getRaisedType(stmt)
      if (!raisedType) continue

      // Check if the raised exception is caught by the except clause
      if (exceptTypes.has(raisedType) || exceptTypes.has('Exception') || exceptTypes.has('BaseException')) {
        return makeViolation(
          this.ruleKey, stmt, filePath, 'low',
          'Raise within try body',
          `Raising \`${raisedType}\` inside the \`try\` block that also catches it — this creates confusing control flow.`,
          sourceCode,
          'Extract the raising logic to a separate function, or restructure to avoid catching your own raises.',
        )
      }
    }
    return null
  },
}
