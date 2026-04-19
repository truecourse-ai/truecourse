import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: async with anyio.CancelScope(...) or trio.CancelScope(...) without await/checkpoint

const CANCEL_SCOPE_CONTEXTS = new Set([
  'anyio.CancelScope', 'trio.CancelScope',
  'anyio.move_on_after', 'anyio.fail_after',
  'trio.move_on_after', 'trio.fail_after',
  'asyncio.timeout', 'asyncio.timeout_at',
])

function hasAwait(node: SyntaxNode): boolean {
  if (node.type === 'await') return true
  // Don't descend into nested async function definitions
  if (node.type === 'function_definition' && node.children[0]?.type === 'async') return false
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && hasAwait(child)) return true
  }
  return false
}

export const pythonCancelScopeNoCheckpointVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/cancel-scope-no-checkpoint',
  languages: ['python'],
  nodeTypes: ['with_statement'],
  visit(node, filePath, sourceCode) {
    // Check if this is a cancel scope context manager
    const withClause = node.childForFieldName('value')

    // Find the context expression
    let contextText = ''
    for (const child of node.namedChildren) {
      if (child.type === 'with_clause' || child.type === 'as_pattern') {
        contextText = child.text
        break
      }
    }

    // Search all named children for the context manager call
    let isCancelScope = false
    function findCancelScope(n: SyntaxNode) {
      if (n.type === 'call') {
        const fn = n.childForFieldName('function')
        if (fn && CANCEL_SCOPE_CONTEXTS.has(fn.text)) {
          isCancelScope = true
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) findCancelScope(child)
      }
    }
    findCancelScope(node)

    if (!isCancelScope) return null

    // Check if the body has any await expression
    const body = node.childForFieldName('body')
    if (!body) return null

    if (!hasAwait(body)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Cancel scope without checkpoint',
        `Async cancel scope or timeout block has no \`await\` expression — cancellation is never checked and the timeout will never trigger.`,
        sourceCode,
        'Add at least one `await` checkpoint inside the cancel scope body.',
      )
    }
    return null
  },
}
