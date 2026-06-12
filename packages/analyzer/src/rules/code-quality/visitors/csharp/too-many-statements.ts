import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import {
  CSHARP_METHODLIKE_TYPES,
  CSHARP_STATEMENT_TYPES,
  getCSharpFunctionName,
  isCSharpFunctionBoundary,
} from './_helpers.js'

const MAX_STATEMENTS = 50

/**
 * Counts statements recursively (including nested if/loop/try bodies),
 * unlike max-statements-per-function which only counts a method's top-level
 * statements. Nested lambdas, local functions, and type declarations are
 * charged to themselves, not the enclosing method.
 */
function countStatements(node: SyntaxNode, root: SyntaxNode): number {
  let count = 0
  for (const child of node.namedChildren) {
    if (!child) continue
    if (isCSharpFunctionBoundary(child.type) && child.id !== root.id) continue
    if (child.type === 'class_declaration' || child.type === 'struct_declaration'
      || child.type === 'record_declaration') continue
    if (CSHARP_STATEMENT_TYPES.has(child.type) && child.type !== 'block') count++
    count += countStatements(child, root)
  }
  return count
}

export const csharpTooManyStatementsVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-statements',
  languages: ['csharp'],
  nodeTypes: CSHARP_METHODLIKE_TYPES,
  visit(node, filePath, sourceCode) {
    const body = node.childForFieldName('body')
    if (!body || body.type !== 'block') return null

    const count = countStatements(body, node)
    if (count <= MAX_STATEMENTS) return null

    const name = getCSharpFunctionName(node)
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Too many statements',
      `Method \`${name}\` has ${count} statements (threshold: ${MAX_STATEMENTS}). This method is too long and should be broken down into smaller methods.`,
      sourceCode,
      'Extract related groups of statements into helper methods with descriptive names.',
    )
  },
}
