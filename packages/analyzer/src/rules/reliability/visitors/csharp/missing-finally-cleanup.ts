import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { simpleTypeName } from './_helpers.js'

/** IDisposable resource types whose construction acquires an OS handle/connection. */
const RESOURCE_TYPES = new Set([
  'FileStream', 'StreamReader', 'StreamWriter', 'BinaryReader', 'BinaryWriter',
  'SqlConnection', 'SqliteConnection', 'NpgsqlConnection', 'MySqlConnection', 'OracleConnection',
  'TcpClient', 'UdpClient', 'NetworkStream',
])

/** Static factory methods on System.IO.File that open a handle. */
const FILE_OPEN_METHODS = new Set([
  'Open', 'OpenRead', 'OpenWrite', 'OpenText', 'Create', 'CreateText', 'AppendText',
])

const FUNCTION_BOUNDARIES = new Set([
  'lambda_expression',
  'anonymous_method_expression',
  'local_function_statement',
])

/** True when the resource acquisition is covered by a `using` statement/declaration on its path up to `stopAt`. */
function isCleanedByUsing(creation: SyntaxNode, stopAt: SyntaxNode): boolean {
  let current: SyntaxNode = creation
  let parent: SyntaxNode | null = creation.parent
  while (parent && current.id !== stopAt.id) {
    // `using var f = …;` / `await using var f = …;` — the declaration carries
    // an anonymous `using` keyword child.
    if (
      parent.type === 'local_declaration_statement' &&
      parent.children.some((c) => c?.type === 'using')
    ) return true
    // `using (var f = …) { … }` — cleaned only when the creation is in the
    // resource clause, not somewhere inside the using's body block.
    if (parent.type === 'using_statement') {
      const body = parent.childForFieldName('body')
      if (!body || current.id !== body.id) return true
    }
    current = parent
    parent = parent.parent
  }
  return false
}

export const csharpMissingFinallyCleanupVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/missing-finally-cleanup',
  languages: ['csharp'],
  nodeTypes: ['try_statement'],
  visit(node, filePath, sourceCode) {
    if (node.namedChildren.some((c) => c?.type === 'finally_clause')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    let leak: { node: SyntaxNode; what: string } | null = null

    function search(n: SyntaxNode) {
      if (leak) return
      // Different lifetime/scope — a lambda may run after the try completes.
      if (FUNCTION_BOUNDARIES.has(n.type)) return
      // A nested try that has its own finally handles its own resources.
      if (
        n.type === 'try_statement' &&
        n.namedChildren.some((c) => c?.type === 'finally_clause')
      ) return

      if (n.type === 'object_creation_expression') {
        const typeName = simpleTypeName(n.childForFieldName('type')?.text ?? '')
        if (RESOURCE_TYPES.has(typeName) && !isCleanedByUsing(n, body!)) {
          leak = { node: n, what: `new ${typeName}(...)` }
          return
        }
      }
      if (n.type === 'invocation_expression') {
        const receiver = simpleTypeName(getCSharpReceiver(n))
        const method = getCSharpMethodName(n)
        if (receiver === 'File' && FILE_OPEN_METHODS.has(method) && !isCleanedByUsing(n, body!)) {
          leak = { node: n, what: `File.${method}(...)` }
          return
        }
      }
      for (const child of n.namedChildren) {
        if (child) search(child)
      }
    }
    search(body)

    if (!leak) return null
    const { node: leakNode, what } = leak as { node: SyntaxNode; what: string }

    return makeViolation(
      this.ruleKey, leakNode, filePath, 'medium',
      'Missing finally cleanup for resource',
      `Resource opened with ${what} in a try block without a finally clause or using declaration. If an exception is thrown, the handle leaks.`,
      sourceCode,
      'Declare the resource with `using var …` (or `await using`), or dispose it in a finally block.',
    )
  },
}
