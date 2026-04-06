import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

const MAX_STATEMENTS = 50

function countStatements(node: SyntaxNode): number {
  let count = 0
  for (const child of node.namedChildren) {
    // Don't count into nested function/class bodies
    if (child.type === 'function_definition' || child.type === 'class_definition') continue
    count++
    // Recursively count nested blocks (if/for/while/with/try bodies)
    const bodyTypes = ['block', 'else_clause', 'elif_clause', 'except_clause', 'finally_clause']
    for (const subChild of child.namedChildren) {
      if (bodyTypes.includes(subChild.type)) {
        count += countStatements(subChild)
      }
    }
  }
  return count
}

export const pythonTooManyStatementsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-statements',
  languages: ['python'],
  nodeTypes: ['function_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body) return null

    const count = countStatements(body)

    if (count > MAX_STATEMENTS) {
      const nameNode = node.childForFieldName('name')
      const name = nameNode?.text || 'function'
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Too many statements',
        `Function \`${name}\` has ${count} statements (threshold: ${MAX_STATEMENTS}). This function is too long and should be broken down into smaller functions.`,
        sourceCode,
        'Extract related groups of statements into helper functions with descriptive names.',
      )
    }

    return null
  },
}
