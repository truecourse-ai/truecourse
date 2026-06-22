import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * A hand-written `if (arg == null) throw new ArgumentNullException(nameof(arg))`
 * guard restates `ArgumentNullException.ThrowIfNull(arg)`, which is one line and
 * cannot get the parameter name wrong (CA1510 / RCS1255). The check fires on an
 * `if_statement` whose condition is `<id> == null` (or `null == <id>`) and whose
 * single consequence is `throw new ArgumentNullException(...)`.
 */
function nullComparedIdentifier(condition: SyntaxNode | null): string | null {
  if (condition?.type !== 'binary_expression') return null
  if (condition.childForFieldName('operator')?.text !== '==') return null
  const left = condition.childForFieldName('left')
  const right = condition.childForFieldName('right')
  if (left?.type === 'identifier' && right?.type === 'null_literal') return left.text
  if (right?.type === 'identifier' && left?.type === 'null_literal') return right.text
  return null
}

function singleThrowOf(branch: SyntaxNode | null, exceptionType: string): SyntaxNode | null {
  if (!branch) return null
  let stmt: SyntaxNode | null = branch
  if (branch.type === 'block') {
    const stmts = branch.namedChildren.filter((c) => c && c.type !== 'comment')
    if (stmts.length !== 1) return null
    stmt = stmts[0]!
  }
  if (stmt?.type !== 'throw_statement') return null
  const creation = stmt.namedChildren.find((c) => c?.type === 'object_creation_expression')
  if (!creation) return null
  const typeName = creation.namedChildren.find((c) => c?.type === 'identifier' || c?.type === 'qualified_name')?.text
  const simple = typeName?.split('.').pop()
  return simple === exceptionType ? creation : null
}

export const csharpUseArgumentNullExceptionThrowHelperVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/use-argumentnullexception-throwhelper',
  languages: ['csharp'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const id = nullComparedIdentifier(node.childForFieldName('condition'))
    if (!id) return null

    // Reject if there's an else branch — that's not a plain guard.
    const branches = node.namedChildren.filter(
      (c) => c && c.id !== node.childForFieldName('condition')?.id,
    ) as SyntaxNode[]
    if (branches.length !== 1) return null

    if (!singleThrowOf(branches[0], 'ArgumentNullException')) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Use ArgumentNullException.ThrowIfNull',
      `This if-null-then-throw guard restates \`ArgumentNullException.ThrowIfNull(${id})\`, which is shorter and cannot get the parameter name wrong.`,
      sourceCode,
      `Replace the guard with \`ArgumentNullException.ThrowIfNull(${id});\`.`,
    )
  },
}
