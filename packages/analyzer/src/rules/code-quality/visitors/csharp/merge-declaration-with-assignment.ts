import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Declaring a local on one line and assigning it on the very next leaves a
 * window in which the variable is in scope but uninitialized, and splits one
 * idea across two statements (RCS1127). Merging into `var x = …;` is clearer
 * and removes the window. The check fires on a `local_declaration_statement`
 * declaring a single uninitialized variable whose immediately following
 * statement is a plain `=` assignment to that same variable.
 *
 * The two statements must be adjacent: an intervening statement may compute the
 * value to assign, so the split would be necessary and is left alone.
 */

function singleUninitializedDeclarator(stmt: SyntaxNode): SyntaxNode | null {
  const decl = stmt.namedChildren.find((c) => c?.type === 'variable_declaration')
  if (!decl) return null
  const declarators = decl.namedChildren.filter((c) => c?.type === 'variable_declarator')
  if (declarators.length !== 1) return null
  const declarator = declarators[0]!
  // An initialized declarator has an `=` and a value child; reject it.
  if (declarator.children.some((c) => c?.text === '=')) return null
  return declarator.childForFieldName('name') ?? declarator.namedChildren[0] ?? null
}

function assignedTarget(stmt: SyntaxNode): { name: string; assign: SyntaxNode } | null {
  if (stmt.type !== 'expression_statement') return null
  const expr = stmt.namedChildren[0]
  if (expr?.type !== 'assignment_expression') return null
  const op = expr.childForFieldName('operator')
  if (op && op.text !== '=') return null
  const left = expr.childForFieldName('left') ?? expr.namedChildren[0]
  if (left?.type !== 'identifier') return null
  return { name: left.text, assign: expr }
}

export const csharpMergeDeclarationWithAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/merge-declaration-with-assignment',
  languages: ['csharp'],
  nodeTypes: ['local_declaration_statement'],
  visit(node, filePath, sourceCode) {
    // `const` / `using` declarations can't be split this way.
    if (node.children.some((c) => c?.type === 'modifier' || c?.text === 'using')) return null

    const nameNode = singleUninitializedDeclarator(node)
    if (!nameNode) return null

    let next = node.nextNamedSibling
    while (next && next.type === 'comment') next = next.nextNamedSibling
    if (!next) return null

    const target = assignedTarget(next)
    if (!target || target.name !== nameNode.text) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Merge variable declaration with its assignment',
      `Local \`${nameNode.text}\` is declared and then assigned on the next line, leaving it briefly uninitialized; merge them into a single \`${nameNode.text} = …;\` declaration (RCS1127).`,
      sourceCode,
      `Combine the declaration and the following assignment of \`${nameNode.text}\` into one statement.`,
    )
  },
}
