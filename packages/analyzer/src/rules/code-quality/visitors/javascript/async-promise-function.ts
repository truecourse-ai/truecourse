import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const asyncPromiseFunctionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/async-promise-function',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_declaration', 'function_expression', 'arrow_function', 'method_definition'],
  visit(node, filePath, sourceCode) {
    // Skip async functions — already fine
    const isAsync = node.children.some((c) => c.type === 'async' || c.text === 'async')
    if (isAsync) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Find `return new Promise(executor)` in the body and return the executor
    function findReturnedPromiseExecutor(n: SyntaxNode): SyntaxNode | null {
      if (n.type === 'return_statement') {
        const ret = n.namedChildren[0]
        if (ret?.type === 'new_expression') {
          const ctor = ret.childForFieldName('constructor')
          if (ctor?.text === 'Promise') {
            const args = ret.childForFieldName('arguments')
            const exec = args?.namedChildren[0]
            if (exec && (exec.type === 'arrow_function' || exec.type === 'function_expression')) {
              return exec
            }
            return exec ?? null
          }
        }
      }
      // Don't descend into nested functions
      if (n.id !== body?.id && (n.type === 'function_declaration' || n.type === 'function_expression'
        || n.type === 'arrow_function' || n.type === 'method_definition')) return null
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) {
          const r = findReturnedPromiseExecutor(child)
          if (r) return r
        }
      }
      return null
    }

    const executor = findReturnedPromiseExecutor(body)
    if (!executor) return null

    // The executor must be a function with a body we can inspect — otherwise
    // we can't tell whether `resolve` is deferred and shouldn't flag.
    if (executor.type !== 'arrow_function' && executor.type !== 'function_expression') return null
    const execBody = executor.childForFieldName('body')
    if (!execBody) return null

    // Read the executor's param names so we can recognize when resolve/reject
    // is passed as a callback identifier (the deferred-resolver pattern, e.g.
    // `this.resolvers.set(id, resolve)`).
    const params = executor.childForFieldName('parameters')
    const paramNames: string[] = []
    if (params) {
      for (const p of params.namedChildren) {
        // required_parameter / optional_parameter wraps an identifier; plain
        // identifier appears for `x => ...` arrow functions
        if (p.type === 'identifier') paramNames.push(p.text)
        else {
          const id = p.childForFieldName('pattern') ?? p.namedChildren.find((c) => c.type === 'identifier')
          if (id) paramNames.push(id.text)
        }
      }
    }
    const resolveName = paramNames[0] ?? null
    const rejectName = paramNames[1] ?? null

    // If resolve is never called synchronously — i.e. every reference to it
    // sits inside a nested callback OR it's passed as an identifier
    // argument to be invoked later — the function can't be rewritten as a
    // simple async returning a value. Detect either pattern by walking the
    // executor body for call_expression args that are callbacks or that
    // pass resolve/reject by name.
    if (executorDefersResolution(execBody, resolveName, rejectName)) return null

    const nameNode = node.childForFieldName('name')
    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Non-async function returns new Promise',
      `Function \`${nameNode?.text ?? 'anonymous'}\` explicitly constructs a \`new Promise\` — mark it \`async\` and use \`await\` instead.`,
      sourceCode,
      'Mark the function `async` and replace `new Promise(...)` with `await`.',
    )
  },
}

function executorDefersResolution(
  execBody: SyntaxNode,
  resolveName: string | null,
  rejectName: string | null,
): boolean {
  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'call_expression') {
      const args = n.childForFieldName('arguments')
      if (args) {
        for (const arg of args.namedChildren) {
          // Callback passed inline → resolve will be invoked later by the callee.
          if (arg.type === 'arrow_function' || arg.type === 'function_expression') {
            found = true
            return
          }
          // resolve/reject passed by identifier → stored or used as callback.
          if (arg.type === 'identifier') {
            if (resolveName && arg.text === resolveName) { found = true; return }
            if (rejectName && arg.text === rejectName) { found = true; return }
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const c = n.child(i)
      if (c) walk(c)
    }
  }
  walk(execBody)
  return found
}
