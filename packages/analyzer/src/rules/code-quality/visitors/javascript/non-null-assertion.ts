import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Flags `expr!` non-null assertions, except when the surrounding code provably
 * narrows the asserted value to non-null in ways TypeScript itself can't track.
 *
 * Suppressed (FP) patterns:
 *  - Map has/get+set:  `if (!m.has(k)) m.set(k, []); m.get(k)!`
 *  - Length-guarded pop/shift: `if (arr.length > N) arr.pop()!`, `while (arr.length > 0) arr.shift()!`
 *  - Same-expression conditional invariant: `if (x.foo) … x.foo!`, `cond ? … x! : …`, JSX/short-circuit `&&`
 *  - Closure-boundary guards: `enabled: !!X` sibling property, `$if(!!X, cb => …X!…)`, `if (!X) return` before async cb
 *  - Early throw / return: `if (!X) throw …` (or `return`) before `X!`
 *  - Sequential assignment: `let r: T|null = null; … r = a; … r = b; … return r!`
 *  - Filter predicate: `.filter(x => x.foo).map(x => x.foo!)`
 *  - Reassign + downstream null check: `if (!x) x = …!; if (x) …`
 */

const ASSIGN_OPS = new Set(['=', '||=', '??='])

/** Tree-sitter exposes the operator as an anonymous child; find it by walking children. */
function getAssignOperator(call: SyntaxNode): string | null {
  for (let i = 0; i < call.childCount; i++) {
    const c = call.child(i)
    if (c && !c.isNamed && ASSIGN_OPS.has(c.text)) return c.text
  }
  return null
}

export const nonNullAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/non-null-assertion',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['non_null_expression'],
  visit(node, filePath, sourceCode) {
    const inner = innerExpression(node)
    if (!inner) return defaultViolation(node, filePath, sourceCode, this.ruleKey)

    // The "asserted target" — what the `!` is making non-null.
    //   x!.foo            -> target is x
    //   x.y!.z            -> target is x.y
    //   map.get(k)!.push  -> target is map.get(k); receiver=map, args=[k]
    //   arr.pop()!        -> target is arr.pop(); receiver=arr
    const targetText = inner.text

    // --- Pattern: Map has/get(+set) -------------------------------------
    if (isMapGetCall(inner)) {
      const recv = getCallReceiver(inner)
      const arg0 = getFirstArgText(inner)
      if (recv && arg0 && hasMapHasGuard(node, recv, arg0)) return null
    }

    // --- Pattern: Array pop/shift inside length guard -------------------
    if (isArrayPopOrShift(inner)) {
      const recv = getCallReceiver(inner)
      if (recv && isLengthGuarded(node, recv)) return null
    }

    // --- Pattern: same-expression conditional invariant -----------------
    if (isInvariantByEnclosingCondition(node, targetText)) return null

    // --- Pattern: filter-predicate then map(x => x.foo!) ----------------
    if (isFilterPredicateGuarded(node, targetText)) return null

    // --- Pattern: enabled: !!X / $if(!!X, …) closure-boundary guard -----
    if (isClosureBoundaryGuarded(node, targetText)) return null

    // --- Pattern: early-return / early-throw guard ----------------------
    if (hasEarlyExitGuard(node, targetText)) return null

    // --- Pattern: reassign + downstream check (cors.ts shape) -----------
    if (isReassignDownstreamGuarded(node, targetText)) return null

    // --- Pattern: sequential assignment on all branches -----------------
    if (isSequentiallyAssigned(node, targetText)) return null

    return defaultViolation(node, filePath, sourceCode, this.ruleKey)
  },
}

// ────────────────────────────────────────────────────────────────────────
// Helpers

function defaultViolation(node: SyntaxNode, filePath: string, sourceCode: string, ruleKey: string) {
  return makeViolation(
    ruleKey, node, filePath, 'medium',
    'Non-null assertion',
    '`!` postfix asserts a value is non-null, bypassing TypeScript null checks. This can cause runtime errors.',
    sourceCode,
    'Add a proper null check or use optional chaining (`?.`) instead.',
  )
}

/** The expression being asserted (strip the trailing `!`). */
function innerExpression(node: SyntaxNode): SyntaxNode | null {
  // tree-sitter shape: (non_null_expression <expr>!)
  // The named child is the asserted expression.
  return node.namedChildren.find((c) => c !== null) ?? null
}

/** For a call_expression `recv.method(args)`, return `recv` text. */
function getCallReceiver(call: SyntaxNode): string | null {
  if (call.type !== 'call_expression') return null
  const fn = call.childForFieldName('function')
  if (!fn || fn.type !== 'member_expression') return null
  const obj = fn.childForFieldName('object')
  return obj?.text ?? null
}

function getCallMethodName(call: SyntaxNode): string | null {
  if (call.type !== 'call_expression') return null
  const fn = call.childForFieldName('function')
  if (!fn || fn.type !== 'member_expression') return null
  return fn.childForFieldName('property')?.text ?? null
}

function getFirstArgText(call: SyntaxNode): string | null {
  if (call.type !== 'call_expression') return null
  const args = call.childForFieldName('arguments')
  if (!args) return null
  const first = args.namedChildren.find((c) => c !== null)
  return first?.text ?? null
}

function isMapGetCall(node: SyntaxNode): boolean {
  return node.type === 'call_expression' && getCallMethodName(node) === 'get'
}

function isArrayPopOrShift(node: SyntaxNode): boolean {
  if (node.type !== 'call_expression') return false
  const m = getCallMethodName(node)
  return m === 'pop' || m === 'shift'
}

// ----- Map.has guard ----------------------------------------------------

/**
 * True if the surrounding scope contains `<recv>.has(<arg>)` either as the
 * guard of a sibling `if` (with set/initialise inside) or anywhere earlier
 * in the same enclosing block / function body.
 */
function hasMapHasGuard(node: SyntaxNode, recv: string, arg: string): boolean {
  const fn = findEnclosingFunction(node)
  const scope = fn ?? findEnclosingStatementBlock(node)
  if (!scope) return false
  return scopeContainsHas(scope, node, recv, arg)
}

function scopeContainsHas(scope: SyntaxNode, before: SyntaxNode, recv: string, arg: string): boolean {
  let found = false
  walkPre(scope, (n) => {
    if (found) return false
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function')
      if (fn?.type === 'member_expression') {
        const obj = fn.childForFieldName('object')?.text
        const prop = fn.childForFieldName('property')?.text
        const argText = n.childForFieldName('arguments')?.namedChildren.find((c) => c !== null)?.text
        if (prop === 'has' && obj === recv && argText === arg && n.endIndex <= before.startIndex) {
          found = true
          return false
        }
      }
    }
    return true
  })
  return found
}

// ----- Length-guarded loop / if ----------------------------------------

function isLengthGuarded(node: SyntaxNode, recv: string): boolean {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'if_statement' || cur.type === 'while_statement' || cur.type === 'for_statement') {
      const cond = cur.childForFieldName('condition')
      if (cond && containsLengthCheck(cond, recv)) return true
    }
    cur = cur.parent
  }
  return false
}

function containsLengthCheck(cond: SyntaxNode, recv: string): boolean {
  let found = false
  walkPre(cond, (n) => {
    if (found) return false
    if (n.type === 'binary_expression') {
      const left = n.childForFieldName('left')
      const op = n.childForFieldName('operator')?.text
      if (
        left?.type === 'member_expression' &&
        left.childForFieldName('object')?.text === recv &&
        left.childForFieldName('property')?.text === 'length' &&
        (op === '>' || op === '>=' || op === '!==' || op === '!=')
      ) {
        found = true
        return false
      }
    }
    // also accept `arr.length` truthiness (no binary op)
    if (n.type === 'member_expression') {
      if (
        n.childForFieldName('object')?.text === recv &&
        n.childForFieldName('property')?.text === 'length' &&
        n.parent?.type !== 'binary_expression'
      ) {
        found = true
        return false
      }
    }
    return true
  })
  return found
}

// ----- Conditional invariant: enclosing condition tested same expr -----

function isInvariantByEnclosingCondition(node: SyntaxNode, targetText: string): boolean {
  // Walk up looking for an enclosing if/ternary/&&-short-circuit whose
  // condition mentions targetText (or a prefix thereof).
  let cur: SyntaxNode | null = node.parent
  let prevId = node.id
  while (cur) {
    // if (cond) { ... target! ... }
    if (cur.type === 'if_statement') {
      const cond = cur.childForFieldName('condition')
      const conseq = cur.childForFieldName('consequence')
      if (cond && conseq && containsId(conseq, prevId) && conditionMentions(cond, targetText)) {
        return true
      }
    }
    // cond ? target! : … OR … ? : target!
    if (cur.type === 'ternary_expression') {
      const cond = cur.childForFieldName('condition')
      if (cond && conditionMentions(cond, targetText)) return true
    }
    // cond && target! / target! && cond is the common JSX short-circuit pattern
    if (cur.type === 'binary_expression') {
      const op = cur.childForFieldName('operator')?.text
      if (op === '&&') {
        const left = cur.childForFieldName('left')
        const right = cur.childForFieldName('right')
        if (left && right && right.id === prevId && conditionMentions(left, targetText)) {
          return true
        }
        if (left && right && left.id === prevId && conditionMentions(right, targetText)) {
          return true
        }
      }
    }
    prevId = cur.id
    cur = cur.parent
  }
  return false
}

function conditionMentions(cond: SyntaxNode, targetText: string): boolean {
  // True if cond textually tests `targetText` for truthiness or non-null.
  // Examples that match (target = "x" or "x.foo"):
  //   x, x.foo, !!x, !!x.foo, x !== null, x != null, Boolean(x), x !== undefined
  const trimmed = targetText.trim()
  let found = false
  walkPre(cond, (n) => {
    if (found) return false
    if (n.text === trimmed) {
      found = true
      return false
    }
    return true
  })
  return found
}

// ----- Filter predicate ------------------------------------------------

/**
 * Pattern: `.filter(x => x.foo).map(x => x.foo!)` — non-null assertion is
 * provably safe because the filter predicate guarantees `x.foo` is truthy.
 * Heuristic: assertion is inside an arrow_function passed as argument to a
 * `.map`/`.flatMap`/`.forEach` whose receiver is a `.filter(pred)` call,
 * and `pred` body mentions the asserted property path (stripped to "param.prop").
 */
function isFilterPredicateGuarded(node: SyntaxNode, targetText: string): boolean {
  // Find enclosing arrow_function passed to a chained method call after .filter
  let cb: SyntaxNode | null = node.parent
  while (cb && cb.type !== 'arrow_function' && cb.type !== 'function_expression') {
    cb = cb.parent
  }
  if (!cb) return false
  const args = cb.parent
  if (!args || args.type !== 'arguments') return false
  const call = args.parent
  if (!call || call.type !== 'call_expression') return false
  const fn = call.childForFieldName('function')
  if (fn?.type !== 'member_expression') return false
  const method = fn.childForFieldName('property')?.text
  if (method !== 'map' && method !== 'flatMap' && method !== 'forEach') return false
  const recv = fn.childForFieldName('object')
  if (!recv || recv.type !== 'call_expression') return false
  const recvFn = recv.childForFieldName('function')
  if (recvFn?.type !== 'member_expression') return false
  if (recvFn.childForFieldName('property')?.text !== 'filter') return false

  // Inspect the filter callback's body — does it mention the asserted property name?
  const filterArgs = recv.childForFieldName('arguments')
  if (!filterArgs) return false
  const filterCb = filterArgs.namedChildren.find((c) => c?.type === 'arrow_function' || c?.type === 'function_expression')
  if (!filterCb) return false
  const body = filterCb.childForFieldName('body')
  if (!body) return false
  // Extract trailing identifier of target (e.g. "field.signedValue" -> "signedValue")
  const propName = targetText.split('.').pop()?.split(/[\[\(]/)[0]
  if (!propName) return false
  return nodeContainsText(body, propName)
}

// ----- Closure-boundary guarded (enabled: !!X / $if(!!X, …)) -----------

function isClosureBoundaryGuarded(node: SyntaxNode, targetText: string): boolean {
  // Walk up to find an enclosing arrow_function / function_expression
  // and inspect its surrounding context.
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'arrow_function' || cur.type === 'function_expression') {
      // Case A: callback is an object-literal property value; sibling property
      // `enabled: !!X` or `enabled: Boolean(X)` matches the assertion target.
      const parentPair = cur.parent
      if (parentPair && parentPair.type === 'pair') {
        const objLit = parentPair.parent
        if (objLit && objLit.type === 'object' && siblingHasEnableGuard(objLit, parentPair, targetText)) {
          return true
        }
      }
      // Case B: callback is an argument to $if(!!X, cb) — first arg is `!!X`
      const args = cur.parent
      if (args && args.type === 'arguments') {
        const firstArg = args.namedChildren.find((c) => c !== null)
        if (firstArg && firstArg.id !== cur.id) {
          if (matchesDoubleBangOrBoolean(firstArg, targetText)) return true
        }
      }
    }
    cur = cur.parent
  }
  return false
}

function siblingHasEnableGuard(objLit: SyntaxNode, exclude: SyntaxNode, targetText: string): boolean {
  for (const pair of objLit.namedChildren) {
    if (!pair || pair.id === exclude.id || pair.type !== 'pair') continue
    const key = pair.childForFieldName('key')?.text
    const val = pair.childForFieldName('value')
    if (!val) continue
    if (key === 'enabled' || key === 'skip') {
      if (matchesDoubleBangOrBoolean(val, targetText)) return true
    }
  }
  return false
}

function matchesDoubleBangOrBoolean(node: SyntaxNode, targetText: string): boolean {
  // !!X
  if (node.type === 'unary_expression') {
    const op = node.childForFieldName('operator')?.text
    if (op === '!') {
      const arg = node.childForFieldName('argument')
      if (arg?.type === 'unary_expression' && arg.childForFieldName('operator')?.text === '!') {
        return arg.childForFieldName('argument')?.text === targetText
      }
    }
  }
  // Boolean(X)
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function')
    if (fn?.text === 'Boolean') {
      const arg = node.childForFieldName('arguments')?.namedChildren.find((c) => c !== null)
      return arg?.text === targetText
    }
  }
  // X (truthy literal as guard — rare but valid)
  if (node.text === targetText) return true
  return false
}

// ----- Early throw / early return guard --------------------------------

/**
 * In the enclosing function body, look for a prior `if (!X) { throw … }` or
 * `if (!X) { return … }`, where X is the assertion target (or a prefix that
 * implies it, e.g. asserting on `account.subscription.id` with guard on
 * `account.subscription`).
 */
function hasEarlyExitGuard(node: SyntaxNode, targetText: string): boolean {
  // Prefixes that count as guards. For "account.subscription.id" we accept
  // guards on "account.subscription" (more conservative narrower wins) too.
  const candidates = new Set<string>()
  const t = targetText.trim()
  candidates.add(t)
  // Strip trailing .prop until we hit a single identifier
  let acc = t
  while (acc.includes('.')) {
    acc = acc.slice(0, acc.lastIndexOf('.'))
    candidates.add(acc)
  }
  // Strip trailing [..] / (..)
  let acc2 = t
  while (true) {
    const open = Math.max(acc2.lastIndexOf('['), acc2.lastIndexOf('('))
    if (open <= 0) break
    acc2 = acc2.slice(0, open)
    candidates.add(acc2)
  }

  // Walk up through all enclosing functions; a guard in any outer scope counts.
  let fn = findEnclosingFunction(node)
  while (fn) {
    const body = fn.childForFieldName('body')
    if (body) {
      let found = false
      walkPre(body, (n) => {
        if (found) return false
        if (n.type === 'if_statement' && n.endIndex <= node.startIndex) {
          const cond = n.childForFieldName('condition')
          const conseq = n.childForFieldName('consequence')
          if (!cond || !conseq) return true
          if (!terminates(conseq)) return true
          if (isNegatedTestOfAny(cond, candidates)) {
            found = true
            return false
          }
        }
        return true
      })
      if (found) return true
    }
    fn = findEnclosingFunction(fn)
  }
  return false
}

function isNegatedTestOfAny(cond: SyntaxNode, candidates: Set<string>): boolean {
  // !X | X === null | X == null | X === undefined | X == undefined
  const stripped = stripParens(cond)
  if (stripped.type === 'unary_expression' && stripped.childForFieldName('operator')?.text === '!') {
    const inner = stripped.childForFieldName('argument')
    if (inner && candidates.has(inner.text)) return true
  }
  if (stripped.type === 'binary_expression') {
    const op = stripped.childForFieldName('operator')?.text
    const left = stripped.childForFieldName('left')?.text
    const right = stripped.childForFieldName('right')?.text
    if (op === '===' || op === '==') {
      if (left && (right === 'null' || right === 'undefined') && candidates.has(left)) return true
      if (right && (left === 'null' || left === 'undefined') && candidates.has(right)) return true
    }
  }
  return false
}

function stripParens(n: SyntaxNode): SyntaxNode {
  let cur: SyntaxNode = n
  while (cur.type === 'parenthesized_expression') {
    const inner = cur.namedChildren.find((c) => c !== null)
    if (!inner) break
    cur = inner
  }
  return cur
}

function terminates(stmt: SyntaxNode): boolean {
  // Bare `return …;` / `throw …;`
  if (stmt.type === 'return_statement' || stmt.type === 'throw_statement') return true
  // `{ return …; }` / `{ throw …; }` / `{ if(...) return; }`
  if (stmt.type === 'statement_block') {
    for (const child of stmt.namedChildren) {
      if (!child) continue
      if (child.type === 'return_statement' || child.type === 'throw_statement') return true
    }
  }
  return false
}

// ----- Reassign + downstream null check (cors.ts shape) -----------------

/**
 * Pattern: inside a guard branch, `x = someExpr!` is followed by an outer
 * `if (x) { … }` that re-checks the value. The `!` is a benign cast — if it
 * actually was null at runtime, the downstream check still handles it safely.
 */
function isReassignDownstreamGuarded(node: SyntaxNode, _targetText: string): boolean {
  // Climb to assignment_expression where the rhs (or its descendant) is `node`.
  let cur: SyntaxNode | null = node.parent
  let prevId = node.id
  while (cur) {
    if (cur.type === 'assignment_expression') {
      const rhs = cur.childForFieldName('right')
      const lhs = cur.childForFieldName('left')
      if (rhs && lhs && nodeContainsId(rhs, prevId)) {
        const varName = lhs.text
        // Look forward in the enclosing function for `if (varName) …`.
        const fn = findEnclosingFunction(cur)
        if (!fn) return false
        const body = fn.childForFieldName('body')
        if (!body) return false
        let downstream = false
        walkPre(body, (n) => {
          if (downstream) return false
          if (n.startIndex <= cur!.endIndex) return true
          if (n.type === 'if_statement') {
            const c = n.childForFieldName('condition')
            if (c && stripParens(c).text === varName) {
              downstream = true
              return false
            }
          }
          return true
        })
        return downstream
      }
    }
    prevId = cur.id
    cur = cur.parent
  }
  return false
}

// ----- Sequential assignment on all branches ---------------------------

/**
 * Pattern:
 *   let r: T | null = null;
 *   if (...) r = a;
 *   else r = b;
 *   return r!;
 * TypeScript can't prove flow, but `r` is assigned on every reachable path.
 *
 * Heuristic (conservative): the asserted target is a plain identifier that is
 * declared as `let X: ... | null = null` (or `let X = …`) in the enclosing
 * function, and there are subsequent assignments to it (one or more), and the
 * assertion comes after those assignments.
 */
function isSequentiallyAssigned(node: SyntaxNode, targetText: string): boolean {
  if (!/^[A-Za-z_$][\w$]*$/.test(targetText.trim())) return false
  const name = targetText.trim()
  const fn = findEnclosingFunction(node)
  if (!fn) return false
  const body = fn.childForFieldName('body')
  if (!body) return false

  let declared = false
  let assignedAfter = false

  walkPre(body, (n) => {
    if (n.type === 'lexical_declaration' || n.type === 'variable_declaration') {
      for (const decl of n.namedChildren) {
        if (decl?.type === 'variable_declarator') {
          const declName = decl.childForFieldName('name')?.text
          if (declName === name) declared = true
        }
      }
    }
    if (n.type === 'assignment_expression' && n.endIndex < node.startIndex) {
      const lhs = n.childForFieldName('left')?.text
      if (lhs === name && getAssignOperator(n)) {
        assignedAfter = true
      }
    }
    return true
  })

  return declared && assignedAfter
}

// ────────────────────────────────────────────────────────────────────────
// Tree-sitter utility wrappers

function findEnclosingFunction(node: SyntaxNode): SyntaxNode | null {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (
      cur.type === 'function_declaration' ||
      cur.type === 'function_expression' ||
      cur.type === 'arrow_function' ||
      cur.type === 'method_definition' ||
      cur.type === 'generator_function_declaration'
    ) {
      return cur
    }
    cur = cur.parent
  }
  return null
}

function findEnclosingStatementBlock(node: SyntaxNode): SyntaxNode | null {
  let cur: SyntaxNode | null = node.parent
  while (cur) {
    if (cur.type === 'statement_block') return cur
    cur = cur.parent
  }
  return null
}

function walkPre(root: SyntaxNode, fn: (n: SyntaxNode) => boolean | void): void {
  const cont = fn(root)
  if (cont === false) return
  for (let i = 0; i < root.namedChildCount; i++) {
    const c = root.namedChild(i)
    if (c) walkPre(c, fn)
  }
}

function containsId(root: SyntaxNode, id: number): boolean {
  let found = false
  walkPre(root, (n) => {
    if (found) return false
    if (n.id === id) {
      found = true
      return false
    }
    return true
  })
  return found
}

function nodeContainsId(root: SyntaxNode, id: number): boolean {
  return containsId(root, id)
}

function nodeContainsText(root: SyntaxNode, text: string): boolean {
  let found = false
  walkPre(root, (n) => {
    if (found) return false
    if (n.type === 'property_identifier' && n.text === text) {
      found = true
      return false
    }
    if (n.type === 'identifier' && n.text === text) {
      found = true
      return false
    }
    return true
  })
  return found
}
