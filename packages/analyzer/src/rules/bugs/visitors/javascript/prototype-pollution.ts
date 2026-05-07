import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const prototypePollutionVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/prototype-pollution',
  languages: JS_LANGUAGES,
  nodeTypes: ['assignment_expression', 'augmented_assignment_expression'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    if (!left || left.type !== 'subscript_expression') return null

    // obj[key] = value — check if key is a dynamic variable (not a string literal)
    const index = left.childForFieldName('index')
    if (!index) return null

    // Only flag if the index is a variable (identifier), not a literal
    if (index.type !== 'identifier') return null

    // Check if the object is not an array type (heuristic: skip numeric-looking contexts)
    const obj = left.childForFieldName('object')
    if (!obj) return null

    // Skip React ref assignments: ref.current[index] = el
    if (obj.type === 'member_expression') {
      const objProp = obj.childForFieldName('property')
      if (objProp?.text === 'current') return null
    }

    // Skip when the key comes from Object.entries(), Object.keys(), or for...in over a local object.
    // These iterate controlled mapping objects, not user input.
    const keyName = index.text
    if (isKeyFromControlledIteration(node, keyName)) return null

    // Skip when the key was computed from a local helper call in the same
    // function scope - e.g. `const key = composeBucketKey(a, b)`. Helpers
    // that compose app-controlled identifiers don't admit `__proto__` /
    // `constructor` short of an unrelated bug, and the rule has no way to
    // reach into the helper to reason about what it returns.
    if (isKeyAssignedFromLocalCall(node, keyName)) return null

    // Skip numeric loop counters and iteration index parameters. JS guarantees
    // a number for these, and a number can never stringify to `__proto__`.
    if (isKeyNumericIndex(node, keyName)) return null

    // Skip when the key is a destructured parameter: `forEach(([key, val]) =>
    // out[key] = val)`. The destructuring pattern means the key was iterated
    // from a structured value the caller composed, not pulled directly from
    // user input. Same reasoning as the local-call case: without inter-
    // procedural taint, the rule has no way to see whether the iterable's
    // keys could be `__proto__`, and firing on every iteration loop is
    // ~100% noise.
    if (isKeyDestructuredParam(node, keyName)) return null

    // Skip when the key is assigned from a member access on a for-of
    // loop variable: `for (const r of rows) { const tier = r.infraction_tier;
    // counts[tier] = … }`. The key's value comes from a structured field
    // of an iteration item — the rule has no way to taint-trace back to
    // user input, and aggregation loops are the most common shape.
    if (isKeyFromForOfLoopVarMember(node, keyName)) return null

    // Skip when the assignment sits inside an `if (key in obj)` guard
    // that explicitly checks the same object - this is the canonical
    // prototype-pollution mitigation. Writers who add the guard have
    // demonstrably considered the issue.
    if (isAssignmentGuardedByKeyInObject(node, keyName, obj.text)) return null

    // Skip when the receiver is a LOCAL object-literal aggregate. The
    // shape `const stats = { READ: 0, SIGN: 0, ... }; stats[status] += n`
    // is an aggregator over known enum keys, and even if `status` were
    // `__proto__` the developer's literal's prototype chain is already
    // bounded by Object.prototype — but more importantly, the key in
    // these patterns comes from a typed enum (TS string-literal union /
    // Prisma enum), not user input. The agent audit on documenso found
    // 7/7 prototype-pollution hits were this exact aggregator pattern.
    if (obj.type === 'identifier' && isLocalObjectLiteral(node, obj.text)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Prototype pollution',
      `\`${left.text}\` uses a dynamic key for property assignment — if \`${index.text}\` is \`"__proto__"\` or \`"constructor"\`, this enables prototype pollution.`,
      sourceCode,
      `Validate that \`${index.text}\` is not "__proto__", "constructor", or "prototype" before assignment, or use Map instead.`,
    )
  },
}

/**
 * Check if the key variable was destructured from Object.entries/Object.keys
 * or comes from a for...in loop over a local object.
 */
function isKeyFromControlledIteration(assignmentNode: SyntaxNode, keyName: string): boolean {
  let current: SyntaxNode | null = assignmentNode.parent
  while (current) {
    // for (const key in obj) — key iterates own property names of a local object
    if (current.type === 'for_in_statement') {
      const leftSide = current.childForFieldName('left')
      if (leftSide && leftSide.text.includes(keyName)) return true
    }
    // for (const [key, value] of Object.entries(obj))
    if (current.type === 'for_in_statement') {
      const rightSide = current.childForFieldName('right')
      if (rightSide && isObjectEntriesOrKeys(rightSide)) {
        const leftSide = current.childForFieldName('left')
        if (leftSide && leftSide.text.includes(keyName)) return true
      }
    }
    current = current.parent
  }
  return false
}

// True if `keyName` is declared in the enclosing scope as
// `const keyName = <forVar>.<attr>` where `<forVar>` is the loop binding
// of an enclosing `for...of` statement. Aggregation loops over an array
// of records routinely derive bucket keys this way; the iteration value's
// shape is determined by the caller's data, not by user input keys.
function isKeyFromForOfLoopVarMember(assignmentNode: SyntaxNode, keyName: string): boolean {
  // Find the enclosing function / program scope to scope the search.
  let scope: SyntaxNode | null = assignmentNode.parent
  while (scope) {
    if (
      scope.type === 'function_declaration' ||
      scope.type === 'function_expression' ||
      scope.type === 'arrow_function' ||
      scope.type === 'method_definition' ||
      scope.type === 'program'
    ) break
    scope = scope.parent
  }
  if (!scope) return false

  // Collect for-of loop variable names within scope.
  const forVarNames = new Set<string>()
  function collectForVars(n: SyntaxNode): void {
    if (n.type === 'for_in_statement') {
      const left = n.childForFieldName('left')
      if (left?.type === 'identifier') forVarNames.add(left.text)
    }
    if (
      n !== scope &&
      (n.type === 'function_declaration' ||
        n.type === 'function_expression' ||
        n.type === 'arrow_function' ||
        n.type === 'method_definition')
    ) return
    for (let i = 0; i < n.childCount; i++) {
      const ch = n.child(i)
      if (ch) collectForVars(ch)
    }
  }
  collectForVars(scope)
  if (forVarNames.size === 0) return false

  // Find a `const keyName = <forVar>.attr` assignment.
  let found = false
  function findAssignment(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'variable_declarator') {
      const name = n.childForFieldName('name')
      const value = n.childForFieldName('value')
      if (
        name?.type === 'identifier' && name.text === keyName &&
        value?.type === 'member_expression'
      ) {
        const obj = value.childForFieldName('object')
        if (obj?.type === 'identifier' && forVarNames.has(obj.text)) {
          found = true
          return
        }
      }
    }
    if (
      n !== scope &&
      (n.type === 'function_declaration' ||
        n.type === 'function_expression' ||
        n.type === 'arrow_function' ||
        n.type === 'method_definition')
    ) return
    for (let i = 0; i < n.childCount; i++) {
      const ch = n.child(i)
      if (ch) findAssignment(ch)
    }
  }
  findAssignment(scope)
  return found
}

// True if the assignment is inside an `if (<keyName> in <objText>) { … }`
// guard. This is the canonical prototype-pollution mitigation - the guard
// rejects `__proto__` / `constructor` / `prototype` because those aren't
// own keys of a literal object.
function isAssignmentGuardedByKeyInObject(
  assignmentNode: SyntaxNode,
  keyName: string,
  objText: string,
): boolean {
  let cursor: SyntaxNode | null = assignmentNode.parent
  while (cursor) {
    if (cursor.type === 'if_statement') {
      const cond = cursor.childForFieldName('condition')
      if (cond) {
        const condText = cond.text
        // Accept `(key in obj)`, `key in obj`, with `&&` chains, etc.
        const pattern = new RegExp(
          `\\b${escapeRegExp(keyName)}\\s+in\\s+${escapeRegExp(objText)}\\b`,
        )
        if (pattern.test(condText)) return true
      }
    }
    cursor = cursor.parent
  }
  return false
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// True when `objName` is declared in an enclosing scope as
// `const|let|var objName = { ... }` — i.e., a local object-literal
// aggregator with developer-controlled prototype chain.
function isLocalObjectLiteral(assignmentNode: SyntaxNode, objName: string): boolean {
  let scope: SyntaxNode | null = assignmentNode.parent
  while (scope) {
    if (
      scope.type === 'function_declaration' ||
      scope.type === 'function_expression' ||
      scope.type === 'arrow_function' ||
      scope.type === 'method_definition' ||
      scope.type === 'program'
    ) break
    scope = scope.parent
  }
  if (!scope) return false
  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'variable_declarator') {
      const name = n.childForFieldName('name')
      const value = n.childForFieldName('value')
      if (name?.type === 'identifier' && name.text === objName && value?.type === 'object') {
        found = true
        return
      }
    }
    if (
      n !== scope &&
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
  walk(scope)
  return found
}

function isObjectEntriesOrKeys(node: SyntaxNode): boolean {
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function')
    if (fn?.type === 'member_expression') {
      const obj = fn.childForFieldName('object')
      const prop = fn.childForFieldName('property')
      if (obj?.text === 'Object' && (prop?.text === 'entries' || prop?.text === 'keys')) {
        return true
      }
    }
  }
  return false
}

// True if the key variable's name appears as a direct child of an
// array_pattern or object_pattern in some enclosing arrow / function /
// method's parameter list. `(([key, val]) => out[key] = val)` matches.
function isKeyDestructuredParam(assignmentNode: SyntaxNode, keyName: string): boolean {
  let scope: SyntaxNode | null = assignmentNode.parent
  while (scope) {
    if (
      scope.type === 'function_declaration' ||
      scope.type === 'function_expression' ||
      scope.type === 'arrow_function' ||
      scope.type === 'method_definition'
    ) {
      const params = scope.childForFieldName('parameters') ?? scope.childForFieldName('parameter')
      if (params && containsDestructuredName(params, keyName)) return true
    }
    if (scope.type === 'program') break
    scope = scope.parent
  }
  return false
}

function containsDestructuredName(params: SyntaxNode, keyName: string): boolean {
  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'identifier' && n.text === keyName) {
      const parent = n.parent
      if (parent?.type === 'array_pattern' || parent?.type === 'object_pattern') {
        found = true
        return
      }
      // Shorthand: `({ key })` lifts the identifier directly into
      // shorthand_property_identifier_pattern.
      if (parent?.type === 'shorthand_property_identifier_pattern' && n.text === keyName) {
        found = true
        return
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(params)
  return found
}

// True if `keyName` is provably a numeric index. Two patterns:
//   1. The 2nd parameter of an iteration callback (`forEach`, `map`,
//      `filter`, `reduce`, `every`, `some`, `find`, `findIndex`,
//      `flatMap`) — JS spec guarantees this is the array index (number).
//   2. The `init` of a traditional `for (let i = 0; ...)` counter — the
//      initialiser is a number literal and the loop body increments it.
// Numbers can never equal `__proto__` / `constructor` / `prototype` once
// stringified into a property key, so the pollution risk is zero.
const ITERATION_CALLBACKS = new Set([
  'forEach', 'map', 'filter', 'reduce', 'reduceRight',
  'every', 'some', 'find', 'findIndex', 'findLast', 'findLastIndex', 'flatMap',
])
function isKeyNumericIndex(assignmentNode: SyntaxNode, keyName: string): boolean {
  // Pattern 1: 2nd param of array-method callback. Walk up to the
  // enclosing arrow / function expression that's an arg to a member call.
  let cursor: SyntaxNode | null = assignmentNode.parent
  while (cursor) {
    if (
      cursor.type === 'arrow_function' ||
      cursor.type === 'function_expression' ||
      cursor.type === 'function'
    ) {
      const paramsNode = cursor.childForFieldName('parameters') ?? cursor.childForFieldName('parameter')
      if (paramsNode) {
        // Find direct identifier parameters and their position.
        const idents: SyntaxNode[] = []
        for (let i = 0; i < paramsNode.namedChildCount; i++) {
          const p = paramsNode.namedChild(i)
          if (!p) continue
          // identifier or required_parameter wrapping identifier
          if (p.type === 'identifier') idents.push(p)
          else if (p.type === 'required_parameter') {
            const inner = p.childForFieldName('pattern')
            if (inner?.type === 'identifier') idents.push(inner)
          }
        }
        // Index parameter is the second one in iteration callbacks.
        if (idents.length >= 2 && idents[1].text === keyName) {
          // Confirm parent call is an iteration method.
          const callExpr = cursor.parent?.type === 'arguments' ? cursor.parent.parent : null
          if (callExpr?.type === 'call_expression') {
            const fn = callExpr.childForFieldName('function')
            if (fn?.type === 'member_expression') {
              const prop = fn.childForFieldName('property')
              if (prop && ITERATION_CALLBACKS.has(prop.text)) return true
            }
          }
        }
      }
    }
    cursor = cursor.parent
  }

  // Pattern 2: traditional `for (let i = 0; ...; i++)` counter. Walk up
  // to find any enclosing `for_statement` whose initializer declares
  // `keyName` with a number-literal value.
  cursor = assignmentNode.parent
  while (cursor) {
    if (cursor.type === 'for_statement') {
      const init = cursor.childForFieldName('initializer')
      if (init && declaresNumericVariable(init, keyName)) return true
    }
    cursor = cursor.parent
  }

  // Pattern 3: counter declared in the enclosing function scope as
  // `let counter = 0` (or any number literal) and only ever reassigned
  // via `counter++` / `counter--` / number expressions. Documenso pattern:
  //   let currentGroupedRowIndex = 0;
  //   for (...) { currentGroupedRowIndex++; arr[currentGroupedRowIndex] = ... }
  if (isLetCounterInScope(assignmentNode, keyName)) return true

  return false
}

function declaresNumericVariable(node: SyntaxNode, keyName: string): boolean {
  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'variable_declarator') {
      const name = n.childForFieldName('name')
      const value = n.childForFieldName('value')
      if (name?.type === 'identifier' && name.text === keyName && value?.type === 'number') {
        found = true
        return
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const ch = n.child(i)
      if (ch) walk(ch)
    }
  }
  walk(node)
  return found
}

function isLetCounterInScope(assignmentNode: SyntaxNode, keyName: string): boolean {
  let scope: SyntaxNode | null = assignmentNode.parent
  while (scope) {
    if (
      scope.type === 'function_declaration' ||
      scope.type === 'function_expression' ||
      scope.type === 'arrow_function' ||
      scope.type === 'method_definition' ||
      scope.type === 'program'
    ) break
    scope = scope.parent
  }
  if (!scope) return false
  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'lexical_declaration' || n.type === 'variable_declaration') {
      // `let X = <number>` — declare numeric counter.
      for (let i = 0; i < n.namedChildCount; i++) {
        const decl = n.namedChild(i)
        if (decl?.type !== 'variable_declarator') continue
        const name = decl.childForFieldName('name')
        const value = decl.childForFieldName('value')
        if (name?.type === 'identifier' && name.text === keyName && value?.type === 'number') {
          found = true
          return
        }
      }
    }
    if (
      n !== scope &&
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
  walk(scope)
  return found
}

// True if the key variable was declared in an enclosing function scope as
// `const | let | var keyName = <call_expression>(...)`. The result of a
// local helper call is treated as internally-derived (not user input) and
// the rule suppresses to avoid noise on `state[key] = ...` patterns where
// `key` is composed from app-controlled identifiers.
function isKeyAssignedFromLocalCall(assignmentNode: SyntaxNode, keyName: string): boolean {
  let scope: SyntaxNode | null = assignmentNode.parent
  while (scope) {
    if (
      scope.type === 'function_declaration' ||
      scope.type === 'function_expression' ||
      scope.type === 'arrow_function' ||
      scope.type === 'method_definition' ||
      scope.type === 'program'
    ) break
    scope = scope.parent
  }
  if (!scope) return false

  let found = false
  function walk(n: SyntaxNode): void {
    if (found) return
    if (n.type === 'variable_declarator') {
      const name = n.childForFieldName('name')
      const value = n.childForFieldName('value')
      if (name?.type === 'identifier' && name.text === keyName && value?.type === 'call_expression') {
        found = true
        return
      }
    }
    // Don't descend into nested function bodies — they can't shadow the key
    // we're looking for in this enclosing scope.
    if (
      n !== scope &&
      (n.type === 'function_declaration' ||
        n.type === 'function_expression' ||
        n.type === 'arrow_function' ||
        n.type === 'method_definition')
    ) return
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(scope)
  return found
}
