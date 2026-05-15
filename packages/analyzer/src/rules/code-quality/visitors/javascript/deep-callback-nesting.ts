import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Returns the body node of an arrow_function / function_expression: either a
 * statement_block or a single expression.
 */
function getCallbackBody(fn: SyntaxNode): SyntaxNode | null {
  // arrow_function: body field is either statement_block or an expression node.
  // function_expression: body is a statement_block.
  const body = fn.childForFieldName('body')
  if (body) return body
  // Fallback — last named child is body for arrow_function with expression body.
  const last = fn.namedChildCount > 0 ? fn.namedChild(fn.namedChildCount - 1) : null
  return last
}

/**
 * Skip wrapping parens / type assertions to get to the underlying expression.
 */
function unwrap(node: SyntaxNode | null): SyntaxNode | null {
  let cur = node
  while (cur) {
    if (cur.type === 'parenthesized_expression' || cur.type === 'as_expression' || cur.type === 'satisfies_expression' || cur.type === 'non_null_expression' || cur.type === 'type_assertion') {
      cur = cur.namedChildCount > 0 ? cur.namedChild(0) : null
      continue
    }
    break
  }
  return cur
}

const TRIVIAL_LITERAL_TYPES = new Set([
  'identifier',
  'property_identifier',
  'shorthand_property_identifier',
  'this',
  'super',
  'number',
  'string',
  'template_string',
  'true',
  'false',
  'null',
  'undefined',
  'regex',
])

const SIMPLE_PREDICATE_METHODS = new Set([
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'filter',
  'some',
  'every',
  'map',
  'flatMap',
  'reduce',
  'forEach',
  'sort',
])

/**
 * Returns true if the expression is "trivial": composed only of literals,
 * identifiers, member-accesses, simple calls, object/array literals, JSX,
 * ternary/binary of trivial things, or a single .find()/.filter()-style call
 * whose predicate is itself a simple-single-expression callback (depth <= 1).
 */
function isTrivialExpression(expr: SyntaxNode | null, allowedNestedCallbacks = 1): boolean {
  const node = unwrap(expr)
  if (!node) return false
  const t = node.type

  if (TRIVIAL_LITERAL_TYPES.has(t)) return true

  if (t === 'member_expression' || t === 'subscript_expression') {
    // Recurse into object child (the part before .prop).
    const obj = node.childForFieldName('object') ?? (node.namedChildCount > 0 ? node.namedChild(0) : null)
    return obj ? isTrivialExpression(obj, allowedNestedCallbacks) : true
  }

  if (t === 'unary_expression' || t === 'update_expression' || t === 'await_expression' || t === 'spread_element') {
    const arg = node.namedChildCount > 0 ? node.namedChild(node.namedChildCount - 1) : null
    return isTrivialExpression(arg, allowedNestedCallbacks)
  }

  if (t === 'binary_expression' || t === 'logical_expression') {
    let allTrivial = true
    for (let i = 0; i < node.namedChildCount; i++) {
      if (!isTrivialExpression(node.namedChild(i), allowedNestedCallbacks)) {
        allTrivial = false
        break
      }
    }
    return allTrivial
  }

  if (t === 'ternary_expression') {
    for (let i = 0; i < node.namedChildCount; i++) {
      if (!isTrivialExpression(node.namedChild(i), allowedNestedCallbacks)) return false
    }
    return true
  }

  if (t === 'object' || t === 'array') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      // For object pairs, check the value side.
      if (child.type === 'pair') {
        const valueChild = child.childForFieldName('value') ?? child.namedChild(1)
        if (!isTrivialExpression(valueChild, allowedNestedCallbacks)) return false
      } else if (child.type === 'spread_element') {
        const inner = child.namedChildCount > 0 ? child.namedChild(0) : null
        if (!isTrivialExpression(inner, allowedNestedCallbacks)) return false
      } else if (child.type === 'shorthand_property_identifier' || child.type === 'property_identifier') {
        continue
      } else {
        if (!isTrivialExpression(child, allowedNestedCallbacks)) return false
      }
    }
    return true
  }

  if (t === 'jsx_element' || t === 'jsx_self_closing_element' || t === 'jsx_fragment') {
    return true
  }

  if (t === 'call_expression' || t === 'new_expression') {
    // A simple call is trivial if all its non-callback arguments are trivial,
    // and any callback argument body is itself a single-expression trivial body
    // (no further nesting allowed beyond `allowedNestedCallbacks`).
    const args = node.childForFieldName('arguments')
    const callee = node.childForFieldName('function') ?? (node.namedChildCount > 0 ? node.namedChild(0) : null)
    if (!callee || !isTrivialExpression(callee, allowedNestedCallbacks)) return false
    if (!args) return true
    for (let i = 0; i < args.namedChildCount; i++) {
      const arg = args.namedChild(i)
      if (!arg) continue
      if (arg.type === 'arrow_function' || arg.type === 'function_expression') {
        if (allowedNestedCallbacks <= 0) return false
        // The nested callback body must itself be a trivial single-expression
        // (or single return of trivial expression), with no further nested
        // callbacks beyond this level.
        const body = getCallbackBody(arg)
        if (!body) return false
        if (body.type === 'statement_block') {
          // Allow a single return statement whose expression is trivial.
          if (body.namedChildCount !== 1) return false
          const stmt = body.namedChild(0)
          if (!stmt || stmt.type !== 'return_statement') return false
          const ret = stmt.namedChildCount > 0 ? stmt.namedChild(0) : null
          if (!isTrivialExpression(ret, allowedNestedCallbacks - 1)) return false
        } else {
          if (!isTrivialExpression(body, allowedNestedCallbacks - 1)) return false
        }
      } else {
        if (!isTrivialExpression(arg, allowedNestedCallbacks)) return false
      }
    }
    return true
  }

  // Default: anything else (statement_block, control flow, switch, try, etc.) is non-trivial.
  return false
}

/**
 * Returns true if the callback's body itself is "trivial" — i.e. a single
 * expression body or a statement_block that:
 *   - contains no branching (if/while/for/switch/try/throw)
 *   - contains no statement-level await
 *   - consists only of simple variable declarations followed by a single
 *     return of a trivial expression.
 */
function isTrivialCallback(fn: SyntaxNode): boolean {
  const body = getCallbackBody(fn)
  if (!body) return false
  if (body.type === 'statement_block') {
    if (body.namedChildCount === 0) return false
    // Walk children; allow lexical_declaration / variable_declaration with
    // trivial initialisers, followed by exactly one return_statement at the
    // end whose expression is trivial.
    let sawReturn = false
    for (let i = 0; i < body.namedChildCount; i++) {
      const stmt = body.namedChild(i)
      if (!stmt) return false
      if (sawReturn) return false // any statement after return → reject.
      if (stmt.type === 'lexical_declaration' || stmt.type === 'variable_declaration') {
        // Each declarator's init must be a trivial expression.
        for (let j = 0; j < stmt.namedChildCount; j++) {
          const declarator = stmt.namedChild(j)
          if (!declarator || declarator.type !== 'variable_declarator') continue
          const value = declarator.childForFieldName('value')
          if (value && !isTrivialExpression(value, 1)) return false
        }
        continue
      }
      if (stmt.type === 'return_statement') {
        const ret = stmt.namedChildCount > 0 ? stmt.namedChild(0) : null
        if (!isTrivialExpression(ret, 1)) return false
        sawReturn = true
        continue
      }
      // Anything else (expression_statement, if, while, for, switch, try,
      // throw, await, etc.) → not trivial.
      return false
    }
    return sawReturn
  }
  // Single-expression arrow body.
  return isTrivialExpression(body, 1)
}

/**
 * Returns true if `node` is the function argument of a `.with(...)` call on a
 * ts-pattern style match chain.
 */
function isInsideTsPatternWith(node: SyntaxNode): boolean {
  // Walk up: arrow_function -> arguments -> call_expression
  const args = node.parent
  if (!args || args.type !== 'arguments') return false
  const call = args.parent
  if (!call || call.type !== 'call_expression') return false
  const callee = call.childForFieldName('function') ?? (call.namedChildCount > 0 ? call.namedChild(0) : null)
  if (!callee || callee.type !== 'member_expression') return false
  const prop = callee.childForFieldName('property')
  if (!prop) return false
  return prop.text === 'with'
}

export const deepCallbackNestingVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/deep-callback-nesting',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['function_expression', 'arrow_function'],
  visit(node, filePath, sourceCode) {
    // ts-pattern: skip callbacks inside .with(...) match chain arms.
    if (isInsideTsPatternWith(node)) return null

    // flat-array-transform-callbacks: skip callbacks whose body is itself
    // trivially simple — single expression / single-return of object literal,
    // property access, or single nested array-method call with trivial predicate.
    if (isTrivialCallback(node)) return null

    let depth = 0
    let parent = node.parent

    while (parent) {
      if (parent.type === 'arguments') {
        depth++
        if (depth >= 4) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Deep callback nesting',
            `Callback nested ${depth} levels deep — refactor using async/await or named functions.`,
            sourceCode,
            'Extract nested callbacks into named functions or use async/await to flatten the nesting.',
          )
        }
      }

      if ((parent.type === 'function_declaration') || parent.type === 'program') break

      parent = parent.parent
    }
    return null
  },
}
