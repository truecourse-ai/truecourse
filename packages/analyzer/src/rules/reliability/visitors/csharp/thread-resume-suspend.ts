import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver, getCSharpRootNode, walkCSharp } from '../../../_shared/csharp-helpers.js'
import { simpleTypeName } from './_helpers.js'

/**
 * `Thread.Suspend()` / `Thread.Resume()` are deprecated (obsolete since .NET
 * Framework 2.0) because they can suspend a thread while it holds a lock,
 * deadlocking any other thread that needs that lock. Matched on the method
 * name plus a receiver that resolves to a `Thread` (the `Thread` type itself,
 * a `Thread`-named receiver, or a field/parameter/local declared `Thread`) so
 * the rule does not collide with unrelated Suspend/Resume APIs (animation,
 * layout) without needing a type checker.
 */
const BANNED = new Set(['Suspend', 'Resume'])

/** True when `name` is declared somewhere in the file with a `Thread`-typed binding. */
function receiverIsThreadTyped(node: SyntaxNode, name: string): boolean {
  let found = false
  walkCSharp(getCSharpRootNode(node), (n) => {
    if (found) return
    // field / local: `Thread _worker;`  → variable_declaration with a declarator named `name`.
    if (n.type === 'variable_declaration') {
      const typeNode = n.namedChildren[0]
      if (simpleTypeName(typeNode?.text ?? '') !== 'Thread') return
      const named = n.namedChildren.some(
        (d) => d?.type === 'variable_declarator' && d.namedChildren[0]?.text === name,
      )
      if (named) found = true
      return
    }
    // parameter: `Thread worker` → parameter whose name identifier matches.
    if (n.type === 'parameter') {
      const ids = n.namedChildren.filter((c) => c?.type === 'identifier')
      if (ids.length >= 2 && ids[ids.length - 1]!.text === name && simpleTypeName(ids[0]!.text) === 'Thread') {
        found = true
      }
    }
  })
  return found
}

export const csharpThreadResumeSuspendVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/thread-resume-suspend',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const method = getCSharpMethodName(node)
    if (!BANNED.has(method)) return null
    if (node.childForFieldName('arguments')?.namedChildCount) return null

    const receiverText = getCSharpReceiver(node)
    const receiver = simpleTypeName(receiverText)
    // `Thread.CurrentThread`, a receiver mentioning Thread, or a Thread-typed binding.
    const looksLikeThread =
      receiver === 'Thread' ||
      receiverText.includes('Thread') ||
      receiverIsThreadTyped(node, receiver)
    if (!looksLikeThread) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      `Thread.${method} is deprecated and unsafe`,
      `Thread.${method}() is deprecated: it can ${method === 'Suspend' ? 'suspend' : 'resume'} a thread while it holds a lock, deadlocking any other thread waiting on that lock. There is no safe way to use these methods.`,
      sourceCode,
      'Coordinate thread pausing cooperatively with a synchronization primitive (ManualResetEventSlim, CancellationToken) instead of Suspend/Resume.',
    )
  },
}
