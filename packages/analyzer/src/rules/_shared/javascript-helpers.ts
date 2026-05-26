/**
 * Shared JavaScript/TypeScript AST helpers for visitors across all rule domains.
 *
 * Helpers in this file are language-level utilities — they don't carry domain
 * knowledge (no "is route handler", no "is ORM call"). Domain-specific helpers
 * still live in each domain's `_helpers.ts`.
 *
 * The goal of this file is to replace fragile text-grep patterns
 * (`text.includes('<')`, `arg.includes(name)`) with proper AST checks that
 * don't leak across substrings, comments, or string literals.
 */
import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { DataFlowContext, Variable } from '../../data-flow/types.js'

/**
 * Tree-sitter node types that represent JSX syntax in TypeScript and JavaScript.
 */
const JSX_NODE_TYPES = new Set([
  'jsx_element',
  'jsx_self_closing_element',
  'jsx_fragment',
  'jsx_expression',
  'jsx_opening_element',
  'jsx_closing_element',
  'jsx_attribute',
])

/**
 * Returns true if `node` itself or any descendant is a JSX element/fragment.
 *
 * Use this instead of textual checks like `text.includes('<')` or
 * `/<[A-Z]/.test(text)`, which match TypeScript generics (`Array<T>`),
 * comparison operators (`a < b`), and angle brackets in comments/strings.
 */
export function containsJsx(node: SyntaxNode): boolean {
  if (JSX_NODE_TYPES.has(node.type)) return true
  for (const child of node.namedChildren) {
    if (containsJsx(child)) return true
  }
  return false
}

/**
 * Returns true if `node` itself or any descendant is an `identifier` whose
 * text exactly equals `name`.
 *
 * Use this instead of `node.text.includes(name)`, which leaks across
 * substrings (`name = "id"` matches `getId`, `valid`, `paid`, etc.) and
 * matches identifiers inside comments and string literals.
 */
export function containsIdentifierExact(node: SyntaxNode, name: string): boolean {
  if (node.type === 'identifier' && node.text === name) return true
  for (const child of node.namedChildren) {
    if (containsIdentifierExact(child, name)) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// findUserInputAccess
// ---------------------------------------------------------------------------

/**
 * Names that, when used as the receiver of a member access, indicate HTTP
 * request data: req.body, request.params, ctx.request.body, event.body, etc.
 *
 * `event` covers AWS Lambda / Cloudflare Workers / Vercel Edge handlers.
 */
const REQUEST_OBJECT_NAMES = new Set(['req', 'request', 'ctx', 'event'])

/**
 * Property names on a request object that hold user-controlled data.
 */
const USER_INPUT_PROPS = new Set([
  'body',
  'params',
  'query',
  'headers',
  'cookies',
  'files',
  'data',
])

export interface UserInputSource {
  /** How the input was found. */
  kind: 'direct-member' | 'aliased-identifier' | 'parameter'
  /** The accessor expression that identified the source. */
  accessor: string
}

/**
 * Returns a UserInputSource if `node` is a member_expression that directly
 * accesses HTTP request data: req.body, request.params, ctx.request.body, etc.
 *
 * Returns null otherwise. Does NOT recurse into children.
 */
function checkDirectMemberAccess(node: SyntaxNode): UserInputSource | null {
  if (node.type !== 'member_expression') return null
  const obj = node.childForFieldName('object')
  const prop = node.childForFieldName('property')
  if (!obj || !prop) return null

  // Form 1: req.body, request.params, event.body
  if (
    obj.type === 'identifier' &&
    REQUEST_OBJECT_NAMES.has(obj.text) &&
    USER_INPUT_PROPS.has(prop.text)
  ) {
    return { kind: 'direct-member', accessor: `${obj.text}.${prop.text}` }
  }

  // Form 2: ctx.request.body — Koa pattern
  if (obj.type === 'member_expression') {
    const innerObj = obj.childForFieldName('object')
    const innerProp = obj.childForFieldName('property')
    if (
      innerObj?.type === 'identifier' &&
      REQUEST_OBJECT_NAMES.has(innerObj.text) &&
      innerProp?.text === 'request' &&
      USER_INPUT_PROPS.has(prop.text)
    ) {
      return {
        kind: 'direct-member',
        accessor: `${innerObj.text}.request.${prop.text}`,
      }
    }
  }

  return null
}

/**
 * Returns true if `variable` is a positional function parameter — i.e., its
 * declaration is a direct identifier in a `formal_parameters` list, not nested
 * inside an `object_pattern` or `array_pattern`.
 *
 * Pattern 2 in `findUserInputAccess` only applies to positional params:
 * `(req, res) => ...` makes `req` mean "the HTTP request object", but
 * `({ ctx, input }) => ...` (the standard tRPC handler shape) destructures
 * `ctx` out of a procedure context object — it is NOT a request, even though
 * the name overlaps with Koa's positional `ctx` handler param.
 */
function isPositionalParameter(variable: Variable): boolean {
  let current: SyntaxNode | null = variable.declarationNode
  while (current) {
    if (current.type === 'object_pattern' || current.type === 'array_pattern') {
      return false
    }
    if (current.type === 'formal_parameters') {
      return true
    }
    if (
      current.type === 'function_declaration' ||
      current.type === 'arrow_function' ||
      current.type === 'function_expression' ||
      current.type === 'method_definition' ||
      current.type === 'program'
    ) {
      return false
    }
    current = current.parent
  }
  return false
}

/**
 * Walk up from a Variable's declarationNode to find the assigned value
 * (the right-hand side of `const x = ...`).
 *
 * For destructuring like `const { body } = req`, the declarationNode is the
 * inner `shorthand_property_identifier_pattern`, so we walk up to find the
 * enclosing `variable_declarator` and extract its `value` field.
 *
 * Returns null for parameters (no RHS) and for var/const without an
 * initializer.
 */
function findVariableInitializerValue(variable: Variable): SyntaxNode | null {
  let current: SyntaxNode | null = variable.declarationNode
  while (current) {
    if (current.type === 'variable_declarator') {
      return current.childForFieldName('value')
    }
    // Stop walking at declaration boundaries — we walked too far if we hit these
    if (
      current.type === 'lexical_declaration' ||
      current.type === 'variable_declaration' ||
      current.type === 'formal_parameters' ||
      current.type === 'function_declaration' ||
      current.type === 'arrow_function' ||
      current.type === 'method_definition' ||
      current.type === 'program'
    ) {
      return null
    }
    current = current.parent
  }
  return null
}

/**
 * Unwrap `await`/parenthesized wrappers to reach the underlying expression
 * (e.g. `await (req.json())` → the `req.json()` call_expression). Used to tell
 * whether a variable's initializer is ultimately a function-call return.
 */
function unwrapToExpression(node: SyntaxNode): SyntaxNode {
  let current = node
  while (current.type === 'await_expression' || current.type === 'parenthesized_expression') {
    const inner = current.namedChildren[0]
    if (!inner) break
    current = inner
  }
  return current
}

/**
 * Returns the first UserInputSource found anywhere in `node`'s subtree, or null.
 *
 * Detects three patterns:
 *  1. Direct member access — `req.body`, `request.params`, `ctx.request.body`,
 *     `event.body` (AWS Lambda style).
 *  2. Function parameters named like request objects — when a handler is
 *     declared as `(req, res) => ...`, references to `req` are user input.
 *  3. Identifiers that resolve via dataFlow to a variable initialized from a
 *     user-input source — e.g. `const { body } = req` or `const x = req.body`.
 *
 * Without `dataFlow`, only patterns (1) and direct uses are detected. Patterns
 * (2) and (3) require scope resolution.
 *
 * Use this instead of `arg.text.includes('req.')`, which leaks across
 * substrings (`bodyParser`, `subQuery`, `everyBody`) and misses destructured
 * aliases entirely.
 *
 * `options.stopTaintAtCallReturns` (default off): when a tracked alias (pattern
 * 3) is initialized from a function-call return value, follow only the
 * callee/receiver, not the call's arguments. A function's return value is a
 * fresh value determined by the function — `const x = build(req.body)` is not
 * itself `req.body` — whereas a method on the request (`req.json()`,
 * `req.body()`) still carries user input via its receiver. Callers that want
 * raw-payload semantics (e.g. unvalidated-data-to-DB writes) opt in; the
 * default preserves transitive taint for sink rules that need it.
 */
export function findUserInputAccess(
  node: SyntaxNode,
  dataFlow?: DataFlowContext,
  options?: { stopTaintAtCallReturns?: boolean },
): UserInputSource | null {
  const visited = new Set<number>()

  function walk(n: SyntaxNode): UserInputSource | null {
    if (visited.has(n.id)) return null
    visited.add(n.id)

    // Pattern 1: direct member access
    const direct = checkDirectMemberAccess(n)
    if (direct) return direct

    // Pattern 2 & 3: identifier resolution via scope
    if (n.type === 'identifier' && dataFlow) {
      const variable = dataFlow.resolveReference(n)
      if (variable) {
        // Pattern 2: positional parameter named like a request object.
        // Destructured params (e.g. tRPC's `({ ctx, input }) => ...`) are
        // skipped because the name overlap is incidental — the destructured
        // `ctx` is a procedure context, not an HTTP request.
        if (
          variable.kind === 'parameter' &&
          REQUEST_OBJECT_NAMES.has(variable.name) &&
          isPositionalParameter(variable)
        ) {
          return { kind: 'parameter', accessor: variable.name }
        }
        // Pattern 3: variable initialized from a user input source
        if (
          variable.kind === 'const' ||
          variable.kind === 'let' ||
          variable.kind === 'var' ||
          variable.kind === 'assignment'
        ) {
          const value = findVariableInitializerValue(variable)
          if (value) {
            // When the initializer is a function-call return value, the result
            // is a fresh value, not the call's arguments. Following only the
            // callee/receiver keeps request-method taint (`req.json()`) while
            // dropping spurious taint from a helper's inputs
            // (`const x = build(req.body)`).
            let toWalk: SyntaxNode | null = value
            if (options?.stopTaintAtCallReturns) {
              const unwrapped = unwrapToExpression(value)
              if (unwrapped?.type === 'call_expression') {
                toWalk = unwrapped.childForFieldName('function')
              }
            }
            const source = toWalk ? walk(toWalk) : null
            if (source) {
              return { kind: 'aliased-identifier', accessor: n.text }
            }
          }
        }
      }
    }

    // Recurse into children
    for (const child of n.namedChildren) {
      const found = walk(child)
      if (found) return found
    }

    return null
  }

  return walk(node)
}
