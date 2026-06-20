import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { CSHARP_FUNCTION_BOUNDARIES } from './_helpers.js'

const TASK_TYPES = new Set(['Task', 'ValueTask'])

/** True when the return type is `Task`, `Task<T>`, `ValueTask`, or `ValueTask<T>`. */
function isTaskReturnType(typeNode: SyntaxNode): boolean {
  let node: SyntaxNode = typeNode
  if (node.type === 'qualified_name') {
    const right = node.namedChildren[node.namedChildren.length - 1]
    if (!right) return false
    node = right
  }
  if (node.type === 'identifier') return TASK_TYPES.has(node.text)
  if (node.type === 'generic_name') {
    const id = node.childForFieldName('name') ?? node.namedChildren[0]
    return id ? TASK_TYPES.has(id.text) : false
  }
  return false
}

/**
 * A `return null` reachable in this method (not a nested function): a
 * `return null;` statement or an expression-bodied `=> null`.
 */
function findReturnNull(node: SyntaxNode): SyntaxNode | null {
  if (node.type === 'arrow_expression_clause') {
    return node.namedChildren[0]?.type === 'null_literal' ? node : null
  }
  if (node.type === 'return_statement') {
    const value = node.namedChildren[0]
    if (value?.type === 'null_literal') return node
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (!child || CSHARP_FUNCTION_BOUNDARIES.has(child.type)) continue
    const found = findReturnNull(child)
    if (found) return found
  }
  return null
}

/**
 * A method declared to return `Task`/`Task<T>` (or `ValueTask`) that does
 * `return null;`. The caller's `await` dereferences the returned task, so a
 * null task throws a `NullReferenceException` at the await — far from where the
 * null originated. The correct empty completed task is `Task.CompletedTask`
 * (or `Task.FromResult(...)` / `ValueTask.CompletedTask`).
 *
 * `async` methods are skipped: in an `async` method `return null` yields the
 * result value, which the compiler wraps in a non-null task.
 */
export const csharpReturnNullTaskVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/return-null-task',
  languages: ['csharp'],
  nodeTypes: ['method_declaration', 'local_function_statement'],
  visit(node, filePath, sourceCode) {
    const isAsync = node.children.some((c) => c?.type === 'modifier' && c.text === 'async')
    if (isAsync) return null

    // method_declaration exposes the return type as `returns`;
    // local_function_statement exposes it as `type`.
    const returnType = node.childForFieldName('returns') ?? node.childForFieldName('type')
    if (!returnType || !isTaskReturnType(returnType)) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const ret = findReturnNull(body)
    if (!ret) return null

    return makeViolation(
      this.ruleKey, ret, filePath, 'high',
      'Returning null from a Task-returning method',
      'A method declared to return a Task returns `null`; awaiting a null task throws a NullReferenceException at the call site.',
      sourceCode,
      'Return `Task.CompletedTask` (or `Task.FromResult(...)` / `ValueTask.CompletedTask`) instead of `null`.',
    )
  },
}
