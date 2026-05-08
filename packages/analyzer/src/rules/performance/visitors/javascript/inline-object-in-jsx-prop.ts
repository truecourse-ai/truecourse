import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isLikelyServerComponent } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

// JSX attribute names whose object/array value is conventionally
// inline because the framework consumes it via deep-equality or
// because hoisting would lose closure-bound state. These props
// don't benefit from useMemo extraction.
const INLINE_OBJECT_PROP_NAMES = new Set([
  // framer-motion: variants / transition / animation configs.
  // The library deep-compares these and re-runs animations only
  // on shape change.
  'initial', 'animate', 'exit', 'transition', 'variants',
  'whileHover', 'whileTap', 'whileFocus', 'whileInView', 'whileDrag',
  'drag', 'dragConstraints', 'dragElastic', 'dragMomentum',
  // React i18n: <Trans values={{...}} components={{...}}>. The
  // values close over per-render scope; components inject JSX
  // child elements.
  'values', 'components',
  // react-select / react-day-picker / similar config props.
  'inputProps', 'classNames', 'styleConfig', 'classes',
  // React/DOM-required object props.
  'dangerouslySetInnerHTML',
  // dnd-kit sensors closure.
  'sensors',
])

/**
 * True if the object/array literal has any value that's NOT a
 * primitive literal — template literals with substitutions,
 * member expressions on closure-bound locals, identifiers,
 * spread of non-module-scope variables. Such literals can't be
 * hoisted to module scope without losing the closure / dynamic
 * value, so flagging them as "inline literal" produces no
 * actionable advice.
 */
function hasDynamicValue(literal: SyntaxNode): boolean {
  const queue: SyntaxNode[] = [literal]
  while (queue.length > 0) {
    const n = queue.pop()!
    // Stop at nested object / array literals — their dynamism
    // is checked separately when visited.
    if (n !== literal && (n.type === 'object' || n.type === 'array')) continue
    if (n.type === 'identifier') return true
    if (n.type === 'member_expression') return true
    if (n.type === 'subscript_expression') return true
    if (n.type === 'template_string') {
      // Has a substitution? (Has any template_substitution child)
      for (let i = 0; i < n.namedChildCount; i++) {
        const c = n.namedChild(i)
        if (c?.type === 'template_substitution') return true
      }
    }
    if (n.type === 'call_expression') return true
    if (n.type === 'arrow_function' || n.type === 'function_expression') return true
    if (n.type === 'spread_element') {
      // `...rest` of a non-literal — typically dynamic.
      return true
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) queue.push(c)
    }
  }
  return false
}

export const inlineObjectInJsxPropVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/inline-object-in-jsx-prop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['jsx_attribute'],
  visit(node, filePath, sourceCode) {
    // Server components don't re-render on the client — inline allocation has no perf impact.
    // Detect by: file is in a Next.js App Router path AND lacks 'use client' directive.
    if (isLikelyServerComponent(filePath, sourceCode)) return null

    const attrName = node.namedChildren[0]
    const attrNameText = attrName?.type === 'property_identifier' ? attrName.text : ''

    // Skip framework/library props where inline objects are the
    // documented API.
    if (INLINE_OBJECT_PROP_NAMES.has(attrNameText)) return null

    const value = node.namedChildren[1]
    if (!value) return null

    const expr = value.type === 'jsx_expression' ? value.namedChildren[0] : value
    if (!expr) return null

    if (expr.type === 'object' || expr.type === 'array') {
      // Skip `style={{ width: dyn }}` and similar where the
      // object contains values bound to render scope (template
      // literals with substitutions, member expressions on
      // local props, identifiers). These literals CANNOT be
      // hoisted to module scope; the perf advice doesn't apply.
      if (hasDynamicValue(expr)) return null

      const kind = expr.type === 'object' ? 'Object' : 'Array'
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        `Inline ${kind.toLowerCase()} literal in JSX prop`,
        `${kind} literal in JSX prop creates a new reference every render, causing unnecessary child re-renders.`,
        sourceCode,
        `Extract the ${kind.toLowerCase()} to a useMemo hook or a constant outside the component.`,
      )
    }

    return null
  },
}
