import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Seed / database-bootstrap scripts run once during setup, are
// intentionally sequential, and are not on any hot path. Treat any file
// whose path contains a `seed/`/`seeds/` directory segment, or whose
// basename matches `seed*.ts` / `*-seed.ts` / `*-seeds.ts`, as out of
// scope for this rule.
const SEED_FILE_PATH_PATTERN = /(?:^|[\\/])(?:seed|seeds)[\\/]|(?:^|[\\/])seed[^\\/]*\.(?:ts|tsx|js|jsx|mjs|cjs)$|[-_.](?:seed|seeds)\.(?:ts|tsx|js|jsx|mjs|cjs)$/i

function isInSeedScript(filePath: string): boolean {
  return SEED_FILE_PATH_PATTERN.test(filePath)
}

// A `while`/`do-while` whose condition steps through a chain via optional
// chaining (`while (node?.parent)`) is a linked-list-style walk: each
// iteration depends on the awaited result of the previous one and can't
// be parallelised. Standard "drain an array" loops use `for-of` or a
// length test, not an optional-chained property access.
function isSerialChainWalk(loopNode: SyntaxNode): boolean {
  if (loopNode.type !== 'while_statement' && loopNode.type !== 'do_statement') {
    return false
  }
  const condition =
    loopNode.childForFieldName('condition') ?? loopNode.childForFieldName('test')
  if (!condition) return false
  return containsOptionalChain(condition)
}

function containsOptionalChain(node: SyntaxNode): boolean {
  if (node.type === 'optional_chain') return true
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && containsOptionalChain(child)) return true
  }
  return false
}

// Walk up from `loopNode` looking for an enclosing arrow/function-expression
// that is the callback argument of a `.$transaction(...)` / `.transaction(...)`
// call. Prisma (and most ORMs) require all queries inside a transaction
// callback to run sequentially against the same connection — parallelising
// them via `Promise.all` is a bug, not a perf win.
function isInsideTransactionCallback(loopNode: SyntaxNode): boolean {
  let cur: SyntaxNode | null = loopNode.parent
  while (cur) {
    if (cur.type === 'arrow_function' || cur.type === 'function_expression') {
      const parent = cur.parent
      if (parent?.type === 'arguments') {
        const callExpr = parent.parent
        if (callExpr?.type === 'call_expression') {
          const fn = callExpr.childForFieldName('function')
          if (fn?.type === 'member_expression') {
            const prop = fn.childForFieldName('property')
            if (prop?.text === '$transaction' || prop?.text === 'transaction') return true
          }
        }
      }
    }
    if (cur.type === 'function_declaration' || cur.type === 'method_definition') return false
    cur = cur.parent
  }
  return false
}

// Iterator-protocol reads (`stream.read()`, `iter.next()`) are inherently
// sequential — each call depends on the underlying iterator's position
// after the previous call. There's no parallel form.
function isIteratorProtocolAwait(awaitNode: SyntaxNode): boolean {
  const call = awaitNode.namedChildren[0]
  if (!call || call.type !== 'call_expression') return false
  const fn = call.childForFieldName('function')
  if (fn?.type !== 'member_expression') return false
  const prop = fn.childForFieldName('property')
  return prop?.text === 'read' || prop?.text === 'next'
}

// Sleep / delay primitives are time-passing — the await *is* the loop's
// pacing mechanism (retry backoff, polling interval, rate-limit gap).
// Parallelising them is nonsensical: N concurrent sleeps just waste the
// same wall-clock time without doing any extra work.
const SLEEP_LIKE_CALL_NAMES = new Set([
  'sleep', 'delay', 'wait', 'pause',
  'setTimeout', 'setImmediate', 'setInterval',
])
function isSleepLikeAwait(awaitNode: SyntaxNode): boolean {
  const call = awaitNode.namedChildren[0]
  if (!call || call.type !== 'call_expression') return false
  const fn = call.childForFieldName('function')
  if (!fn) return false
  let name: string | undefined
  if (fn.type === 'identifier') name = fn.text
  else if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property')
    name = prop?.text
  }
  return name !== undefined && SLEEP_LIKE_CALL_NAMES.has(name)
}

// Cursor-based pagination: `do { ... cursor = result.next; } while (cursor)`.
// Each iteration's input depends on the previous response's cursor token —
// the API contract makes the calls sequential. Detect by: do-while whose
// condition references an identifier that is reassigned inside the body.
function isCursorPaginationLoop(loopNode: SyntaxNode): boolean {
  if (loopNode.type !== 'do_statement') return false
  const condition =
    loopNode.childForFieldName('condition') ?? loopNode.childForFieldName('test')
  if (!condition) return false
  const condIdents = new Set<string>()
  collectIdentifiers(condition, condIdents)
  if (condIdents.size === 0) return false
  const body = loopNode.childForFieldName('body')
  if (!body) return false
  return bodyReassignsAny(body, condIdents)
}

function collectIdentifiers(node: SyntaxNode, out: Set<string>): void {
  if (node.type === 'identifier') {
    out.add(node.text)
    return
  }
  for (let i = 0; i < node.childCount; i++) {
    const ch = node.child(i)
    if (ch) collectIdentifiers(ch, out)
  }
}

function bodyReassignsAny(node: SyntaxNode, names: Set<string>): boolean {
  if (node.type === 'assignment_expression') {
    const left = node.childForFieldName('left')
    if (left?.type === 'identifier' && names.has(left.text)) return true
  }
  for (let i = 0; i < node.childCount; i++) {
    const ch = node.child(i)
    if (ch && bodyReassignsAny(ch, names)) return true
  }
  return false
}

// True if the awaited result is bound to a `const`/`let` declarator and an
// `if (… <binding> …) { return | break | throw }` appears later in the same
// loop body. This is a "search until found" loop where parallelisation
// would speculatively waste work on iterations that early-exit would skip.
function isAwaitUsedInEarlyExit(awaitNode: SyntaxNode, loopNode: SyntaxNode): boolean {
  let parent: SyntaxNode | null = awaitNode.parent
  let bindingName: string | null = null
  while (parent && parent !== loopNode) {
    if (parent.type === 'variable_declarator') {
      const name = parent.childForFieldName('name')
      if (name?.type === 'identifier') bindingName = name.text
      break
    }
    parent = parent.parent
  }
  if (!bindingName) return false

  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'if_statement') {
      const cond = n.childForFieldName('condition')
      const consequence = n.childForFieldName('consequence')
      if (cond && consequence && referencesIdentifier(cond, bindingName!) && containsTerminator(consequence)) {
        found = true
        return
      }
    }
    if (
      n !== loopNode &&
      (n.type === 'function_declaration' ||
        n.type === 'function_expression' ||
        n.type === 'arrow_function' ||
        n.type === 'method_definition')
    ) return
    for (let i = 0; i < n.childCount; i++) {
      const ch = n.child(i)
      if (ch) walk(ch)
    }
  }
  walk(loopNode)
  return found
}

function referencesIdentifier(node: SyntaxNode, name: string): boolean {
  if (node.type === 'identifier' && node.text === name) return true
  for (let i = 0; i < node.childCount; i++) {
    const ch = node.child(i)
    if (ch && referencesIdentifier(ch, name)) return true
  }
  return false
}

function containsTerminator(node: SyntaxNode): boolean {
  if (
    node.type === 'return_statement' ||
    node.type === 'break_statement' ||
    node.type === 'throw_statement'
  ) return true
  if (
    node.type === 'function_declaration' ||
    node.type === 'function_expression' ||
    node.type === 'arrow_function' ||
    node.type === 'method_definition'
  ) return false
  for (let i = 0; i < node.childCount; i++) {
    const ch = node.child(i)
    if (ch && containsTerminator(ch)) return true
  }
  return false
}

export const awaitInLoopVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/await-in-loop',
  languages: JS_LANGUAGES,
  nodeTypes: ['await_expression'],
  visit(node, filePath, sourceCode) {
    if (isInSeedScript(filePath)) return null

    // Walk up the tree to find if we're inside a loop
    let current: SyntaxNode | null = node.parent
    while (current) {
      const t = current.type
      if (t === 'for_statement' || t === 'for_in_statement' || t === 'while_statement' || t === 'do_statement') {
        if (isSerialChainWalk(current)) return null
        if (isInsideTransactionCallback(current)) return null
        if (isIteratorProtocolAwait(node)) return null
        if (isSleepLikeAwait(node)) return null
        if (isCursorPaginationLoop(current)) return null
        if (isAwaitUsedInEarlyExit(node, current)) return null
        // Make sure we're in the loop body (not the initializer/condition of a for loop)
        // and not inside a nested async function
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Await inside loop',
          '`await` inside a loop forces sequential execution of async operations. Consider collecting promises and using `Promise.all()` for parallel execution.',
          sourceCode,
          'Extract the async calls into an array and use `await Promise.all(promises)` outside the loop.',
        )
      }
      // Stop recursing if we hit a function boundary
      if (t === 'function_declaration' || t === 'arrow_function' || t === 'function' || t === 'method_definition') {
        break
      }
      current = current.parent
    }
    return null
  },
}
