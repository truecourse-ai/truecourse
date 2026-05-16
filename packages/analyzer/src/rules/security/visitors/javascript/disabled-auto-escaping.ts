import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const disabledAutoEscapingVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/disabled-auto-escaping',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['jsx_attribute', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    // dangerouslySetInnerHTML
    if (node.type === 'jsx_attribute') {
      const name = node.namedChildren[0]
      if (name && name.text === 'dangerouslySetInnerHTML') {
        // Extract the `__html` value from the inline object literal, when
        // possible: `dangerouslySetInnerHTML={{ __html: <value> }}`. The
        // attribute fires only when that value carries a clear user-input
        // signal. Library-rendered SVG, hardcoded markup, admin-controlled
        // config, and operator-supplied env config are the dominant FP
        // shapes; suppress them.
        const htmlValue = extractHtmlValue(node)
        if (htmlValue && isTrustedHtmlValue(htmlValue)) return null

        return makeViolation(
          this.ruleKey, node, filePath, 'high',
          'Disabled auto-escaping',
          'dangerouslySetInnerHTML bypasses React\'s XSS protections.',
          sourceCode,
          'Avoid dangerouslySetInnerHTML. Use safe rendering methods or sanitize input with DOMPurify.',
        )
      }
    }

    // element.innerHTML = ...
    if (node.type === 'assignment_expression') {
      const left = node.childForFieldName('left')
      if (left?.type === 'member_expression') {
        const prop = left.childForFieldName('property')
        if (prop?.text === 'innerHTML') {
          // RHS that admits no user input - empty string, static string
          // literal, or template string with no `${...}` substitutions -
          // is not an XSS sink. Without this, `el.innerHTML = ''` (clear)
          // and `el.innerHTML = '<p>static</p>'` (hard-coded fragment)
          // both fire the rule even though there's no untrusted data.
          const right = node.childForFieldName('right')
          if (right && isStaticStringLiteral(right)) return null

          // RHS that's already escaped: every dynamic substitution / concat
          // operand goes through a known escape helper (`esc()`,
          // `escapeHtml()`, `sanitize()`, `DOMPurify.sanitize()`, etc.).
          // The audit found ~100% of remaining FPs were these patterns.
          if (right && isFullyEscapedRhs(right)) return null

          return makeViolation(
            this.ruleKey, node, filePath, 'high',
            'Disabled auto-escaping',
            'Direct innerHTML assignment can lead to XSS vulnerabilities.',
            sourceCode,
            'Use textContent instead of innerHTML, or sanitize input with DOMPurify.',
          )
        }
      }
    }

    return null
  },
}

// Walk `dangerouslySetInnerHTML={{ __html: <value> }}` and return the AST
// node for `<value>`. Returns null when the attribute is shaped any other
// way (variable spread, conditional, etc.) — in that case the visitor
// falls through to firing.
function extractHtmlValue(
  attr: import('web-tree-sitter').Node,
): import('web-tree-sitter').Node | null {
  // attr.namedChild(1) is the jsx_expression wrapping the value
  const jsxExpr = attr.namedChild(1)
  if (!jsxExpr || jsxExpr.type !== 'jsx_expression') return null
  const obj = jsxExpr.namedChild(0)
  if (!obj || obj.type !== 'object') return null
  for (let i = 0; i < obj.namedChildCount; i++) {
    const pair = obj.namedChild(i)
    if (!pair || pair.type !== 'pair') continue
    const key = pair.childForFieldName('key')
    if (!key || key.text !== '__html') continue
    return pair.childForFieldName('value')
  }
  return null
}

// True when the JSX __html value lacks any clear user-input signal.
// Static markup, library-call output (renderQrSvg(...), mermaid.render),
// admin/config member access (banner.data.content), and template strings
// whose substitutions are static / JSON.stringify / escape calls are all
// treated as deliberate, trusted uses. Plain `+` concatenation with
// non-escaped operands remains a sink.
function isTrustedHtmlValue(node: import('web-tree-sitter').Node): boolean {
  // Hardcoded markup / numeric / boolean literal.
  if (isStaticStringLiteral(node)) return true
  if (node.type === 'number' || node.type === 'true' || node.type === 'false' || node.type === 'null' || node.type === 'undefined') return true
  // Library / helper invocation — developer explicitly opted into the
  // function's output (renderQrSvg, mermaid.render, sanitize, etc.).
  if (node.type === 'call_expression') return true
  // Identifier or member expression — typically state set from a library
  // (`const [svg, setSvg] = useState(); ... __html: svg`) or
  // admin-controlled config (`banner.data.content`). No direct user-input
  // sink without flow analysis.
  if (node.type === 'identifier' || node.type === 'member_expression') return true
  // Template string: trusted only when every substitution is itself a
  // trusted value (escape call, JSON.stringify, static, identifier, etc.).
  if (node.type === 'template_string') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === 'template_substitution') {
        const inner = child.namedChild(0)
        if (!inner) return false
        if (!isTrustedHtmlValue(inner) && !isFullyEscapedRhs(inner)) return false
      }
    }
    return true
  }
  return false
}

function isStaticStringLiteral(node: import('web-tree-sitter').Node): boolean {
  if (node.type === 'string') return true
  if (node.type === 'template_string') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === 'template_substitution') return false
    }
    return true
  }
  return false
}

// Helper-function names that conventionally escape / sanitize HTML. Calls
// to these are treated as XSS-safe.
const ESCAPE_HELPER_NAMES = new Set([
  'esc', 'escape', 'escapeHtml', 'escapeHTML', 'escapeHtmlEntities',
  'htmlEscape', 'htmlEntities', 'sanitize', 'sanitizeHtml', 'sanitizeHTML',
  'purify',
])

function isEscapeCall(node: import('web-tree-sitter').Node): boolean {
  if (node.type !== 'call_expression') return false
  const fn = node.childForFieldName('function')
  if (!fn) return false
  if (fn.type === 'identifier') return ESCAPE_HELPER_NAMES.has(fn.text)
  if (fn.type === 'member_expression') {
    const prop = fn.childForFieldName('property')
    if (prop && ESCAPE_HELPER_NAMES.has(prop.text)) return true
    // DOMPurify.sanitize(...) — receiver named DOMPurify
    const obj = fn.childForFieldName('object')
    if (obj?.type === 'identifier' && /purify/i.test(obj.text)) return true
  }
  return false
}

// True if every dynamic interpolation / concatenation operand in the RHS
// is wrapped in an escape-helper call. Static string fragments and
// numeric literals are inherently safe.
function isFullyEscapedRhs(node: import('web-tree-sitter').Node): boolean {
  if (node.type === 'string') return true
  if (node.type === 'number') return true
  if (node.type === 'true' || node.type === 'false' || node.type === 'null' || node.type === 'undefined') return true
  if (isEscapeCall(node)) return true
  if (node.type === 'template_string') {
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === 'template_substitution') {
        const inner = child.namedChild(0)
        if (!inner || !isFullyEscapedRhs(inner)) return false
      }
    }
    return true
  }
  if (node.type === 'binary_expression') {
    const op = node.children.find((c) => c.text === '+')
    if (!op) return false
    const lhs = node.childForFieldName('left')
    const rhs = node.childForFieldName('right')
    if (!lhs || !rhs) return false
    return isFullyEscapedRhs(lhs) && isFullyEscapedRhs(rhs)
  }
  return false
}
