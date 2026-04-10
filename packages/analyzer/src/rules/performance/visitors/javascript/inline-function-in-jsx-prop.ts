import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { isLikelyServerComponent } from './_helpers.js'

export const inlineFunctionInJsxPropVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/inline-function-in-jsx-prop',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['jsx_attribute'],
  visit(node, filePath, sourceCode) {
    // Server components don't re-render on the client — inline allocation has no perf impact.
    if (isLikelyServerComponent(filePath, sourceCode)) return null

    // jsx_attribute has a name child and a value child
    // The value for expression props is jsx_expression containing the actual expression
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
