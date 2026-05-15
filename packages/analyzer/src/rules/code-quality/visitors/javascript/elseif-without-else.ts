import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

/**
 * Returns true if the body of a branch (statement_block or single statement)
 * ends with a terminator: return_statement or throw_statement.
 */
function branchTerminates(body: SyntaxNode | null | undefined): boolean {
  if (!body) return false
  if (body.type === 'return_statement' || body.type === 'throw_statement') return true
  if (body.type === 'statement_block') {
    // Find the last named child (skip comments, punctuation)
    const named = body.namedChildren.filter((c): c is SyntaxNode => c !== null)
    if (named.length === 0) return false
    const last = named[named.length - 1]
    if (!last) return false
    return last.type === 'return_statement' || last.type === 'throw_statement'
  }
  return false
}

/**
 * Returns true if the statement immediately following the if-chain in its
 * enclosing block is a return_statement or throw_statement (i.e. a default
 * handler).
 */
function hasDefaultAfterChain(chainRoot: SyntaxNode): boolean {
  const parent = chainRoot.parent
  if (!parent) return false
  // Find the index of chainRoot among parent's named children.
  const siblings = parent.namedChildren.filter((c): c is SyntaxNode => c !== null)
  const idx = siblings.findIndex((c) => c.id === chainRoot.id)
  if (idx === -1) return false
  const next = siblings[idx + 1]
  if (!next) return false
  return next.type === 'return_statement' || next.type === 'throw_statement'
}

export const elseifWithoutElseVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/elseif-without-else',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['if_statement'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (parent?.type === 'else_clause') return null

    // Skip files in /components/ui/ directories (third-party generated components like shadcn/ui)
    if (/\/components\/ui\//.test(filePath)) return null

    let hasElseIf = false
    let hasElse = false

    // Collect branch bodies (the `if` body + each `else if` body) so we can
    // verify the "every branch returns/throws" condition.
    const branchBodies: SyntaxNode[] = []

    let currentNode: SyntaxNode | null = node
    while (currentNode?.type === 'if_statement') {
      // The consequence (then-body) of the current if is its `consequence` field.
      const consequence = currentNode.childForFieldName?.('consequence')
        ?? currentNode.namedChildren.find((c) => c?.type === 'statement_block' || c?.type === 'return_statement' || c?.type === 'throw_statement' || c?.type === 'expression_statement')
      if (consequence) branchBodies.push(consequence)

      const elseClause: import('web-tree-sitter').Node | undefined = currentNode.children.find((c) => c?.type === 'else_clause') ?? undefined
      if (!elseClause) break

      const elseBody: import('web-tree-sitter').Node | undefined = elseClause.namedChildren[0] ?? undefined
      if (!elseBody) break

      if (elseBody.type === 'if_statement') {
        hasElseIf = true
        currentNode = elseBody
      } else {
        hasElse = true
        break
      }
    }

    if (!hasElseIf || hasElse) return null

    // Only flag when every branch terminates (return/throw) AND no default
    // return/throw follows the chain. This is the classic "missing default
    // case" pattern; chains used for side-effects or that have an explicit
    // fall-through default after them are intentional and not violations.
    const everyBranchTerminates = branchBodies.length > 0 && branchBodies.every(branchTerminates)
    if (!everyBranchTerminates) return null
    if (hasDefaultAfterChain(node)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'else-if chain without final else',
      '`if...else if` chain has no final `else` clause — unhandled cases may be silently ignored.',
      sourceCode,
      'Add a final `else` clause to handle unexpected cases, or document why it is intentionally omitted.',
    )
  },
}
