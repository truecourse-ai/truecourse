import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

const MAX_STATEMENTS = 30

const STATEMENT_TYPES = new Set([
  'expression_statement', 'variable_declaration', 'lexical_declaration', 'return_statement',
  'if_statement', 'for_statement', 'for_in_statement', 'while_statement',
  'do_statement', 'switch_statement', 'try_statement', 'throw_statement',
  'break_statement', 'continue_statement', 'labeled_statement',
  'import_statement', 'export_statement',
])

function countStatements(bodyNode: SyntaxNode): number {
  let count = 0
  for (let i = 0; i < bodyNode.childCount; i++) {
    const child = bodyNode.child(i)
    if (child && STATEMENT_TYPES.has(child.type)) {
      count++
    }
  }
  return count
}

export const maxStatementsPerFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/max-statements-per-function',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'statement_block') return null

    const count = countStatements(body)
    if (count <= MAX_STATEMENTS) return null

    const nameNode = node.childForFieldName('name')
    const name = nameNode?.text || 'anonymous'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      `Function has ${count} statements`,
      `Function \`${name}\` has ${count} statements — maximum is ${MAX_STATEMENTS}. Break it into smaller functions.`,
      sourceCode,
      'Extract groups of related statements into smaller helper functions.',
    )
  },
}
