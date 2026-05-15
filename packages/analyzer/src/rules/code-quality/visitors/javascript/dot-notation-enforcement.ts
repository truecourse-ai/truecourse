import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Valid JS identifier pattern
const IDENTIFIER_RE = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/
// SCREAMING_SNAKE / all-uppercase identifier-style keys (typed constant maps, env vars, enum names)
// Examples: 'DATABASE_URL', 'MANAGE_TEAM', 'INVALID_REQUEST', 'EVERYONE', 'GOOGLE_CLIENT_ID'
const SCREAMING_SNAKE_RE = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$|^[A-Z]{3,}$/
// Sentinel-style keys: '__OWNER__', '__SENTINEL__'
const SENTINEL_RE = /^__[A-Z0-9_]+__$/
// Reserved words that must use bracket notation
const RESERVED = new Set([
  'break', 'case', 'catch', 'continue', 'debugger', 'default', 'delete', 'do',
  'else', 'finally', 'for', 'function', 'if', 'in', 'instanceof', 'new', 'return',
  'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'class', 'const', 'enum', 'export', 'extends', 'import', 'super', 'implements',
  'interface', 'let', 'package', 'private', 'protected', 'public', 'static', 'yield',
])

/**
 * Walk up looking for an `if`/`&&` guard that tests `'<key>' in <objText>` for the same key+object.
 * This is the defensive narrowing idiom: `if ('x' in obj) { obj['x'] }`.
 */
function isInGuarded(node: SyntaxNode, objText: string, key: string): boolean {
  const needle1 = `'${key}' in ${objText}`
  const needle2 = `"${key}" in ${objText}`
  let scope: SyntaxNode | null = node.parent
  let hops = 0
  while (scope && hops < 12) {
    if (
      scope.type === 'if_statement'
      || scope.type === 'binary_expression'
      || scope.type === 'parenthesized_expression'
      || scope.type === 'expression_statement'
      || scope.type === 'ternary_expression'
    ) {
      const text = scope.text
      if (text.includes(needle1) || text.includes(needle2)) return true
    }
    if (scope.type === 'function_declaration' || scope.type === 'arrow_function'
      || scope.type === 'function_expression' || scope.type === 'method_definition'
      || scope.type === 'program') break
    scope = scope.parent
    hops++
  }
  return false
}

/**
 * Walk the chain of subscript/member expressions rooted at this node (both ancestors and descendants
 * along the access path) and return true if ANY sibling subscript uses a string key that is NOT a
 * valid identifier (e.g. ':userId', 'email-password'). This is the chain-consistency idiom: when
 * one sibling requires brackets, the whole chain uses brackets for stylistic uniformity.
 */
function hasChainSiblingRequiringBrackets(node: SyntaxNode): boolean {
  // Walk up: collect contiguous member/subscript ancestors.
  let top: SyntaxNode = node
  while (top.parent && (top.parent.type === 'subscript_expression' || top.parent.type === 'member_expression')) {
    top = top.parent
  }
  // Now walk down from `top` along the object/index path and check each subscript.
  const stack: SyntaxNode[] = [top]
  while (stack.length) {
    const n = stack.pop()!
    if (n === node) continue
    if (n.type === 'subscript_expression') {
      const idx = n.childForFieldName('index')
      if (idx && idx.type === 'string') {
        const k = idx.text.slice(1, -1)
        if (!IDENTIFIER_RE.test(k) || RESERVED.has(k)) return true
      }
    }
    // Descend into the object side (left side of chain) for both subscript and member expressions
    const obj = n.childForFieldName('object')
    if (obj && (obj.type === 'subscript_expression' || obj.type === 'member_expression')) {
      stack.push(obj)
    }
  }
  return false
}

/**
 * Walk down to the chain "namespace" — the root identifier plus, if rooted at `this`, the first
 * member access (e.g. `this.client`). Returns null for non-identifier-rooted chains.
 */
function chainRootText(n: SyntaxNode): string | null {
  const stack: SyntaxNode[] = []
  let cur: SyntaxNode = n
  while (cur.type === 'subscript_expression' || cur.type === 'member_expression') {
    stack.push(cur)
    const o = cur.childForFieldName('object')
    if (!o) return null
    cur = o
  }
  if (cur.type === 'this') {
    // include the first member property (e.g. `this.client`) — `this` alone is too coarse.
    const outer = stack[stack.length - 1]
    if (outer && outer.type === 'member_expression') {
      const prop = outer.childForFieldName('property')
      if (prop) return `this.${prop.text}`
    }
    return 'this'
  }
  if (cur.type === 'identifier') return cur.text
  return null
}

/**
 * File-level chain-consistency: search the entire program for subscript chains sharing the same
 * chain-root identifier (e.g. `this.client`, `apiClient`). If any of those subscripts uses a
 * non-identifier string key (e.g. `[':id']`, `['email-password']`), treat sibling chains as
 * stylistically consistent and skip them.
 */
function fileChainHasNonIdentifierSibling(node: SyntaxNode, obj: SyntaxNode): boolean {
  // Compute chain root (e.g. `this` or `apiClient`) plus the first property after the root if any
  // — that's the "namespace" for siblings (e.g. `this.client`).
  const root = chainRootText(obj)
  if (!root) return false
  // Find the program node
  let prog: SyntaxNode = node
  while (prog.parent) prog = prog.parent
  const stack: SyntaxNode[] = [prog]
  while (stack.length) {
    const n = stack.pop()!
    if (n.type === 'subscript_expression') {
      const idx = n.childForFieldName('index')
      const innerObj = n.childForFieldName('object')
      if (idx && innerObj && idx.type === 'string') {
        const r = chainRootText(innerObj)
        if (r === root) {
          const k = idx.text.slice(1, -1)
          if (!IDENTIFIER_RE.test(k) || RESERVED.has(k)) return true
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return false
}

/**
 * Search the entire program for `declare function <name>(...): ...Record<...>` or similar so we can
 * infer that `const X = name(...)` returns a Record-like type.
 */
function functionReturnsRecord(node: SyntaxNode, fnName: string): boolean {
  let prog: SyntaxNode = node
  while (prog.parent) prog = prog.parent
  const text = prog.text
  // Looser regex match: `function <name>(...): ... Record<...>` or `=> Record<...>` near a `function <name>`
  const re = new RegExp(`function\\s+${fnName}\\s*[^{]*?(?:Record<|\\{\\s*\\[)`, 's')
  if (re.test(text)) return true
  return false
}

/**
 * Detect arrow/function-expression parameters that are passed as callbacks to collection methods
 * like `.map`, `.filter`, `.forEach`, `.reduce`, `.flatMap`, `.find`, `.some`, `.every`. In these
 * cases the parameter's type is inferred from the collection's element type, which is commonly a
 * Record-like shape (e.g. CSV rows, query results). Bracket access here is idiomatic.
 */
const COLLECTION_METHODS = new Set([
  'map', 'filter', 'forEach', 'reduce', 'flatMap', 'find', 'findIndex', 'some', 'every', 'sort', 'flatMap',
])

function isCallbackParamInCollectionMethod(objIdent: SyntaxNode, contextNode: SyntaxNode): boolean {
  const name = objIdent.text
  // Walk up scopes; if the immediate enclosing function is a callback inside a collection-method
  // call AND the function declares `name` as a parameter (typed or not), return true.
  let scope: SyntaxNode | null = contextNode.parent
  while (scope) {
    if (
      scope.type === 'arrow_function'
      || scope.type === 'function_expression'
      || scope.type === 'function_declaration'
    ) {
      const params = scope.childForFieldName('parameters')
      let declaresName = false
      if (params) {
        for (let i = 0; i < params.namedChildCount; i++) {
          const p = params.namedChild(i)
          if (!p) continue
          if (p.text === name) { declaresName = true; break }
          if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
            const pat = p.childForFieldName('pattern') ?? p.namedChild(0)
            if (pat && pat.type === 'identifier' && pat.text === name) { declaresName = true; break }
          }
          if (p.type === 'identifier' && p.text === name) { declaresName = true; break }
        }
      }
      if (declaresName) {
        // Is this function the argument of a `.<collection>(...)` call?
        const parent = scope.parent
        if (parent && parent.type === 'arguments') {
          const call = parent.parent
          if (call && call.type === 'call_expression') {
            const callee = call.childForFieldName('function')
            if (callee && callee.type === 'member_expression') {
              const propName = callee.childForFieldName('property')?.text
              if (propName && COLLECTION_METHODS.has(propName)) return true
            }
          }
        }
      }
      return false
    }
    if (scope.type === 'program') break
    scope = scope.parent
  }
  return false
}

/**
 * Determine if the given identifier was bound via an `object_pattern` (destructuring) in a
 * function parameter, and the parameter's type annotation includes Record< or {[. Example:
 *   handler: (req: { params: Record<string,string>; query: Record<string,string> }) => ...
 *   handler(async ({ query }) => { query['code'] })
 */
function isDestructuredFromRecord(node: SyntaxNode, name: string): boolean {
  let scope: SyntaxNode | null = node.parent
  while (scope) {
    if (
      scope.type === 'function_declaration'
      || scope.type === 'function_expression'
      || scope.type === 'arrow_function'
      || scope.type === 'method_definition'
    ) {
      const params = scope.childForFieldName('parameters')
      if (params) {
        for (let i = 0; i < params.namedChildCount; i++) {
          const p = params.namedChild(i)
          if (!p) continue
          // The parameter is a destructuring pattern (object_pattern) binding `name`.
          if (paramDestructures(p, name)) {
            // If the parameter's annotation contains Record<…> or index signature → skip.
            if (p.text.includes('Record<') || /\{\s*\[/.test(p.text)) return true
            // If the parameter has no explicit annotation, treat as a callback whose shape was
            // dictated by the caller (framework handler, route handler, etc.). Bracket access is
            // typically required because the destructured field's type is decided externally.
            if (p.type === 'object_pattern') return true
            // Or the parameter is `required_parameter`/`optional_parameter` wrapping an object_pattern
            // without a type field — also treat as externally-typed.
            if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
              const typeField = p.childForFieldName('type')
              const pat = p.childForFieldName('pattern') ?? p.namedChild(0)
              if (!typeField && pat && pat.type === 'object_pattern') return true
            }
          }
        }
      }
    }
    if (scope.type === 'program') break
    scope = scope.parent
  }
  return false
}

/**
 * Walks a parameter node to see if it destructures a property named `name`.
 */
function paramDestructures(p: SyntaxNode, name: string): boolean {
  // DFS through the parameter for any binding of `name` inside an object/array pattern.
  const stack: SyntaxNode[] = [p]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur.type === 'shorthand_property_identifier_pattern' && cur.text === name) return true
    if (cur.type === 'pair_pattern') {
      const val = cur.childForFieldName('value')
      if (val && val.type === 'identifier' && val.text === name) return true
    }
    if (cur.type === 'identifier' && cur.text === name && cur.parent
      && (cur.parent.type === 'object_pattern' || cur.parent.type === 'array_pattern')) {
      return true
    }
    for (let i = 0; i < cur.namedChildCount; i++) {
      const c = cur.namedChild(i)
      if (c) stack.push(c)
    }
  }
  return false
}

/**
 * Resolve the "kind" of the object expression. We care about distinguishing simple identifiers
 * that are directly declared as function parameters (the TP shape `function f(obj: ...)`) from
 * member-expressions, casts, destructured params, etc.
 */
function isSimpleDirectFunctionParameter(objNode: SyntaxNode, contextNode: SyntaxNode): boolean {
  if (objNode.type !== 'identifier') return false
  const name = objNode.text
  // Walk up to find the enclosing function declaration/expression/arrow and check if `name` is a
  // direct (non-destructured, non-rest) named parameter at the parameter level.
  let scope: SyntaxNode | null = contextNode.parent
  while (scope) {
    if (
      scope.type === 'function_declaration'
      || scope.type === 'function_expression'
      || scope.type === 'arrow_function'
      || scope.type === 'method_definition'
    ) {
      const params = scope.childForFieldName('parameters')
      if (params) {
        for (let i = 0; i < params.namedChildCount; i++) {
          const p = params.namedChild(i)
          if (!p) continue
          // required_parameter / optional_parameter wrap a pattern + type
          // We want a direct identifier pattern (NOT destructuring patterns)
          if (p.type === 'required_parameter' || p.type === 'optional_parameter') {
            const pat = p.childForFieldName('pattern') ?? p.namedChild(0)
            if (pat && pat.type === 'identifier' && pat.text === name) return true
          } else if (p.type === 'identifier' && p.text === name) {
            return true
          }
        }
      }
      return false // first enclosing function does not declare this name as a direct param
    }
    scope = scope.parent
  }
  return false
}

/**
 * Walk the enclosing scopes looking for a declaration or parameter for `name`. Return its annotation
 * text snippet (the declaration's text or the parameter's text) if found, else null.
 */
function findDeclarationText(node: SyntaxNode, name: string): string | null {
  let scope: SyntaxNode | null = node.parent
  while (scope) {
    // Check named children for declarations of `name`
    for (let i = 0; i < scope.namedChildCount; i++) {
      const child = scope.namedChild(i)
      if (!child) continue
      if (
        child.type === 'lexical_declaration'
        || child.type === 'variable_declaration'
        || child.type === 'ambient_declaration'
      ) {
        const text = child.text
        // crude: declaration of this identifier as a binding
        if (
          new RegExp(`\\b(?:const|let|var)\\s+${name}\\b`).test(text)
          || new RegExp(`\\bdeclare\\s+(?:const|let|var)\\s+${name}\\b`).test(text)
        ) {
          return text
        }
      }
    }
    // Check function parameters
    if (
      scope.type === 'function_declaration'
      || scope.type === 'function_expression'
      || scope.type === 'arrow_function'
      || scope.type === 'method_definition'
    ) {
      const params = scope.childForFieldName('parameters')
      if (params) {
        for (let i = 0; i < params.namedChildCount; i++) {
          const p = params.namedChild(i)
          if (!p) continue
          if (p.text.includes(name)) return p.text
        }
      }
    }
    if (scope.type === 'program') break
    scope = scope.parent
  }
  return null
}

export const dotNotationEnforcementVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/dot-notation-enforcement',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['subscript_expression'],
  visit(node, filePath, sourceCode) {
    const index = node.childForFieldName('index')
    if (!index) return null

    // Only flag string literal subscripts
    if (index.type !== 'string') return null

    const key = index.text.slice(1, -1) // Remove quotes
    if (!IDENTIFIER_RE.test(key)) return null
    if (RESERVED.has(key)) return null

    const obj = node.childForFieldName('object')
    const objText = obj?.text ?? 'obj'

    // Skip SCREAMING_SNAKE / sentinel keys — these are typed constant-map / enum / env-var lookups
    // by project convention (permission maps, error codes, env vars). Keys like 'MANAGE_TEAM',
    // 'DATABASE_URL', 'EVERYONE', '__OWNER__' carry no dot-notation alternative in practice.
    if (SCREAMING_SNAKE_RE.test(key) || SENTINEL_RE.test(key)) return null

    // Skip `process.env[...]` — Node convention with --noUncheckedIndexedAccess.
    if (obj && obj.type === 'member_expression') {
      const innerObj = obj.childForFieldName('object')
      const innerProp = obj.childForFieldName('property')
      if (innerObj && innerProp && innerObj.text === 'process' && innerProp.text === 'env') return null
      // Skip `*.dataset[...]` — DOMStringMap requires bracket access for kebab dataset-* keys.
      if (innerProp && innerProp.text === 'dataset') return null
    }

    // Skip chain-consistency cases: any sibling subscript on the same access chain uses a
    // string key that is NOT a valid identifier (e.g. ':userId', 'email-password').
    if (hasChainSiblingRequiringBrackets(node)) return null

    // File-level chain consistency: if any subscript chain rooted at the same chain root
    // (e.g. `this`, `apiClient`) elsewhere in the file uses a non-identifier key, treat all
    // sibling chains the same way.
    if (obj && fileChainHasNonIdentifierSibling(node, obj)) return null

    // Skip when guarded by `'<key>' in <obj>` — defensive narrowing.
    if (obj && isInGuarded(node, objText, key)) return null

    // Skip when the object is a cast expression: `(envelope as Record<string, string>)['id']`.
    if (obj && (obj.type === 'as_expression' || obj.type === 'satisfies_expression' || obj.type === 'parenthesized_expression')) {
      const inner = obj.text
      if (inner.includes('Record<') || /\{\s*\[/.test(inner)) return null
    }

    // Skip when the object is itself a member expression whose base type is a Record/index-signature
    // (e.g. `op.context['skipBatch']`, `entry.metadata['userAgent']`, `form.formState.errors['phoneNumber']`).
    // Without full type info we use a conservative heuristic: if the object is a member expression
    // AND not a simple `Foo.BAR` enum-style chain, AND no enclosing parameter list explicitly types
    // the root as a non-Record concrete type, treat the inner property as likely Record-typed.
    if (obj && obj.type === 'member_expression') {
      // Look at the property name (right side) — if it's a common map/record-typed property name
      // OR the chain's root identifier is declared with Record</[ key:/index-signature, skip.
      const rootIdent = (() => {
        let cur: SyntaxNode = obj
        while (cur.type === 'member_expression' || cur.type === 'subscript_expression') {
          const o = cur.childForFieldName('object')
          if (!o) break
          cur = o
        }
        return cur.type === 'identifier' ? cur.text : null
      })()
      if (rootIdent) {
        const declText = findDeclarationText(node, rootIdent)
        if (declText && (declText.includes('Record<') || /\{\s*\[/.test(declText))) return null
      }
      // Heuristic: member-expression objects with property names commonly bound to map-like types.
      const propName = obj.childForFieldName('property')?.text
      if (propName && /^(metadata|context|errors|formState|dataset|headers|params|query|env|attributes|state)$/.test(propName)) {
        return null
      }
    }

    // Resolve the object as an identifier and look up its declaration/parameter annotation.
    if (obj && obj.type === 'identifier') {
      const name = obj.text
      const declText = findDeclarationText(node, name)
      if (declText) {
        // If the declaration carries a Record<...> or index-signature {[key:T]:U}, the bracket
        // access is idiomatic. Exception: a SIMPLE direct function parameter `function f(x: Record<...>)`
        // — preserve current behavior so the unit-test fixture's TP keeps firing.
        const hasRecordType = declText.includes('Record<') || /\{\s*\[/.test(declText)
        if (hasRecordType && !isSimpleDirectFunctionParameter(obj, node)) {
          return null
        }
        // `const X = funcCall(...)` where `funcCall` is declared elsewhere in this file as returning
        // a Record-typed value (e.g. `declare function decodeTokenClaims(t: string): Record<string, unknown>`).
        const callMatch = declText.match(/=\s*([A-Za-z_$][\w$]*)\s*\(/)
        if (callMatch?.[1] && functionReturnsRecord(node, callMatch[1])) return null
        // `const X = { ...other }` — if `other` is declared as Record<...>, the spread carries that
        // index signature into X, so bracket access is idiomatic.
        const spreadMatch = declText.match(/=\s*\{\s*\.\.\.\s*([A-Za-z_$][\w$]*)/)
        if (spreadMatch?.[1]) {
          const innerDecl = findDeclarationText(node, spreadMatch[1])
          if (innerDecl && (innerDecl.includes('Record<') || /\{\s*\[/.test(innerDecl))) return null
        }
      }
      // Destructured parameter from a Record-typed annotation.
      if (isDestructuredFromRecord(node, name)) return null
      // Arrow / callback parameter without type annotation, used inside `.map`/`.filter`/`.forEach`/
      // `.reduce` — typical collection iteration where each element is a Record-like row.
      if (isCallbackParamInCollectionMethod(obj, node)) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Bracket notation when dot notation is available',
      `\`${objText}["${key}"]\` should use dot notation: \`${objText}.${key}\`.`,
      sourceCode,
      `Replace \`${objText}["${key}"]\` with \`${objText}.${key}\`.`,
    )
  },
}
