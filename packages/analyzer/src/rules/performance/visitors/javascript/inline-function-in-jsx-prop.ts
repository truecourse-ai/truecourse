import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isLikelyServerComponent } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

/**
 * True if the arrow function's body is a "trivial passthrough":
 *   onCopy={() => onCopy()}                       — call expression
 *   onCopy={() => onCopy('Local', local)}         — call with args
 *   onMouseEnter={() => { ref.current = true; }}  — single ref/state
 *   onClick={() => void asyncFn()}                — fire-and-forget
 *
 * These wrappers are typically argument adapters: each render
 * creates a new closure over different local values, so
 * `useCallback` wouldn't help (deps would change). The wrapper
 * cost is one allocation per render — overwhelmingly cheaper
 * than the prop-comparison cost users would pay to add
 * memoization.
 *
 * Real targets for this rule are arrow functions with non-trivial
 * bodies (multi-statement blocks, branching, loops) — those have
 * meaningful render-time cost and benefit from extraction.
 */
function isTrivialArrowBody(body: SyntaxNode): boolean {
  // Expression-bodied arrow: `() => expr`
  if (body.type === 'call_expression') return true
  if (body.type === 'await_expression') return true
  if (body.type === 'unary_expression') {
    // `() => void fn()` — `void` operator on a call is a fire-
    // and-forget pattern.
    const operand = body.namedChildren[0]
    if (operand && operand.type === 'call_expression') return true
  }
  if (body.type === 'identifier' || body.type === 'member_expression') return true
  if (body.type === 'assignment_expression') return true
  // Block-bodied arrow: `() => { statement; }` — only when there's
  // exactly one trivial statement.
  if (body.type === 'statement_block') {
    const stmts = body.namedChildren.filter((c) => c.type !== 'comment')
    if (stmts.length === 0) return true
    if (stmts.length > 1) return false
    const only = stmts[0]
    if (only.type === 'expression_statement') {
      const inner = only.namedChildren[0]
      if (inner) return isTrivialArrowBody(inner)
    }
    if (only.type === 'return_statement') {
      const inner = only.namedChildren[0]
      if (inner) return isTrivialArrowBody(inner)
    }
  }
  return false
}

export const inlineFunctionInJsxPropVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/inline-function-in-jsx-prop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['jsx_attribute'],
  visit(node, filePath, sourceCode) {
    // Server components don't re-render on the client — inline allocation has no perf impact.
    if (isLikelyServerComponent(filePath, sourceCode)) return null

    // jsx_attribute has a name child and a value child
    // The value for expression props is jsx_expression containing the actual expression
    const attrName = node.namedChildren[0]
    const attrNameText = attrName?.type === 'property_identifier' ? attrName.text : ''

    // Skip render-prop attribute names — `render` / `renderItem` /
    // `renderRow` / `renderCell` / `children`. These props
    // require a function-as-children pattern; the function MUST
    // be inline because it closes over per-row state from the
    // parent's render scope (e.g., react-hook-form's
    // `<FormField render={({ field }) => ...}>`,
    // virtualized-list `renderRow`).
    if (
      attrNameText === 'render' ||
      attrNameText === 'renderItem' ||
      attrNameText === 'renderRow' ||
      attrNameText === 'renderCell' ||
      attrNameText === 'renderHeader' ||
      attrNameText === 'renderFooter' ||
      attrNameText === 'children'
    ) {
      return null
    }

    const value = node.namedChildren[1]
    if (!value) return null

    // Value is typically jsx_expression wrapping the actual expression
    const expr = value.type === 'jsx_expression' ? value.namedChildren[0] : value

    if (!expr) return null

    // Skip native HTML elements — inline functions on <button>, <input>, <div> etc.
    // don't cause child re-render issues (no React.memo on DOM elements).
    //
    // Custom elements (web components) follow the kebab-case convention:
    // `<my-button>`, `<x-foo>`. They DO support React.memo via wrappers, so
    // we should NOT skip them. The previous code skipped any lowercase tag,
    // which incorrectly exempted custom elements.
    const jsxElement = node.parent // jsx_opening_element or jsx_self_closing_element
    if (jsxElement) {
      const tagName = jsxElement.childForFieldName('name')
      if (tagName?.type === 'identifier') {
        const name = tagName.text
        const startsLower = name[0] === name[0].toLowerCase()
        const isCustomElement = name.includes('-')
        if (startsLower && !isCustomElement) {
          return null // native HTML element like <button>, <input>, <div>
        }
      }
    }

    // Arrow function: () => ...
    if (expr.type === 'arrow_function') {
      // Skip trivial passthroughs (`() => onCopy()`,
      // `() => void asyncFn()`, `() => { ref.current = true }`).
      // These are argument adapters that close over local
      // values; `useCallback` deps would change every render
      // anyway, so extraction has no benefit. Real targets are
      // multi-statement bodies with branching / loops.
      const body = expr.childForFieldName('body')
      if (body && isTrivialArrowBody(body)) return null

      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Inline function in JSX prop',
        'Arrow function in JSX prop creates a new reference every render, defeating React.memo and causing unnecessary child re-renders.',
        sourceCode,
        'Extract the function to a useCallback hook or a component-level function.',
      )
    }

    // .bind() call: onClick={handler.bind(this)}
    if (expr.type === 'call_expression') {
      const fn = expr.childForFieldName('function')
      if (fn?.type === 'member_expression') {
        const prop = fn.childForFieldName('property')
        if (prop?.text === 'bind') {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Inline .bind() in JSX prop',
            '.bind() in a JSX prop creates a new function reference every render.',
            sourceCode,
            'Extract the bound function to a useCallback hook or bind in the constructor.',
          )
        }
      }
    }

    return null
  },
}
