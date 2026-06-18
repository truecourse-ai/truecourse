import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES, isAsyncNamedInvocation } from './_helpers.js'

/**
 * Returning a Task directly from inside a try (with catch/finally) or a
 * using scope: `using (var conn = Open()) { return repo.GetAsync(id); }` —
 * the method returns before the task runs, so the connection is disposed
 * (or the catch is skipped) while the task is still executing.
 * `return await …;` is the fix and never fires.
 */
function usingDeclarationBefore(returnStmt: SyntaxNode, block: SyntaxNode): boolean {
  for (let i = 0; i < block.namedChildCount; i++) {
    const sibling = block.namedChild(i)
    if (!sibling) continue
    if (sibling.id === returnStmt.id || sibling.endIndex > returnStmt.startIndex) break
    if (sibling.type === 'local_declaration_statement' && sibling.children.some((c) => c?.type === 'using')) {
      return true
    }
  }
  return false
}

export const csharpMissingReturnAwaitVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/missing-return-await',
  languages: ['csharp'],
  nodeTypes: ['return_statement'],
  visit(node, filePath, sourceCode) {
    const expr = node.namedChildren[0]
    if (!expr || !isAsyncNamedInvocation(expr)) return null

    let scope = ''
    let chain: SyntaxNode = node
    let current: SyntaxNode | null = node.parent
    while (current && !CSHARP_FUNCTION_BOUNDARIES.has(current.type)) {
      if (current.type === 'using_statement') {
        scope = 'using block'
        break
      }
      if (current.type === 'try_statement' && chain.id === current.childForFieldName('body')?.id) {
        scope = 'try block'
        break
      }
      // `using var x = …;` earlier in the same block also disposes at scope exit
      if (current.type === 'block' && usingDeclarationBefore(chain, current)) {
        scope = 'scope of a using declaration'
        break
      }
      chain = current
      current = current.parent
    }
    if (!scope) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Missing return await',
      `This returns the task directly from inside a ${scope} — the method exits immediately, so the ${scope.startsWith('try') ? 'catch/finally never observes the task\'s exception' : 'using resource is disposed while the task is still running'}.`,
      sourceCode,
      'Use `return await …;` so the task completes inside the protected scope (the method must be async).',
    )
  },
}
