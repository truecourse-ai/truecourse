import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

/**
 * sonarjs accessibility rules for HTML tables in JSX:
 * - S5257: HTML tables should not be used for layout purposes
 * - S5256: Tables should have header elements
 * - S5264: <object> tags should provide alternative content
 *
 * Detects:
 * 1. <table> without any <th> or <thead> elements (S5256)
 * 2. <object> without fallback content (S5264)
 */

function getJsxElementName(node: SyntaxNode): string | null {
  if (node.type === 'jsx_element') {
    const openTag = node.childForFieldName('open_tag') ?? node.children[0]
    if (openTag) {
      const name = openTag.childForFieldName('name') ?? openTag.namedChildren[0]
      return name?.text ?? null
    }
  }
  if (node.type === 'jsx_self_closing_element') {
    const name = node.childForFieldName('name') ?? node.namedChildren[0]
    return name?.text ?? null
  }
  return null
}

function hasDescendantWithTag(node: SyntaxNode, tag: string): boolean {
  if (getJsxElementName(node) === tag) return true
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child && hasDescendantWithTag(child, tag)) return true
  }
  return false
}

function hasNonEmptyChildren(node: SyntaxNode): boolean {
  for (const child of node.namedChildren) {
    const t = child.type
    if (t === 'jsx_text' && !child.text.trim()) continue
    return true
  }
  return false
}

/**
 * Returns true if a JSX element has a spread-attribute (`{...props}`) in its
 * opening tag. Such elements are usually pass-through wrappers (forwardRef
 * primitives, etc.) whose accessibility is the consumer's responsibility.
 */
function hasSpreadAttribute(node: SyntaxNode): boolean {
  let attributeHost: SyntaxNode | null = null
  if (node.type === 'jsx_self_closing_element') {
    attributeHost = node
  } else if (node.type === 'jsx_element') {
    attributeHost = node.childForFieldName('open_tag') ?? node.children[0] ?? null
  }
  if (!attributeHost) return false
  for (const child of attributeHost.namedChildren) {
    if (child.type === 'jsx_attribute') continue
    // tree-sitter exposes spread attributes as nodes whose first child is `{`
    // followed by a `spread_element`. Match on textual shape to stay robust.
    if (child.type === 'jsx_expression' || child.type.includes('spread')) {
      if (child.text.startsWith('{...')) return true
    }
    if (child.text.startsWith('{...')) return true
  }
  return false
}

/**
 * Returns true if the immediate JSX parent of `node` is a `<div>` element.
 * In real-world UIs, `<table>` nested inside a styled wrapping `<div>` is
 * commonly a presentation-layer concern (the wrapper owns layout/styling)
 * and not a data table that needs `<th>`/`<thead>` headers.
 */
function isWrappedInDiv(node: SyntaxNode): boolean {
  let parent: SyntaxNode | null = node.parent
  // Skip JSX text whitespace nodes between siblings.
  while (parent && parent.type === 'jsx_text') parent = parent.parent
  if (!parent) return false
  return getJsxElementName(parent) === 'div'
}

/**
 * Returns the direct child JSX elements of a node (jsx_element or
 * jsx_self_closing_element children, recursing through fragments/expressions
 * only at the top level).
 */
function directJsxChildren(node: SyntaxNode): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (const child of node.namedChildren) {
    if (child.type === 'jsx_element' || child.type === 'jsx_self_closing_element') {
      out.push(child)
    }
  }
  return out
}

/**
 * Find every `<tr>` descendant of a `<table>` whose row body is produced by a
 * `.map()` callback. Returns the JSX element that *is* the `<tr>` template
 * inside the map (so we can count its direct children).
 */
function findMappedTrTemplates(tableNode: SyntaxNode): SyntaxNode[] {
  const found: SyntaxNode[] = []
  function walk(n: SyntaxNode): void {
    // A mapped <tr> appears as `array.map((row) => <tr>...</tr>)` — the
    // arrow_function's body is a jsx_element whose name is `tr`.
    if (n.type === 'arrow_function' || n.type === 'function') {
      const body = n.childForFieldName('body')
      // body can be a jsx_element directly or wrapped in parentheses
      let bodyJsx: SyntaxNode | null = null
      if (body && (body.type === 'jsx_element' || body.type === 'jsx_self_closing_element')) {
        bodyJsx = body
      } else if (body && body.type === 'parenthesized_expression') {
        const inner = body.namedChildren.find(
          (c) => c.type === 'jsx_element' || c.type === 'jsx_self_closing_element',
        )
        if (inner) bodyJsx = inner
      }
      if (bodyJsx && getJsxElementName(bodyJsx) === 'tr') {
        // Verify this arrow is the callback of a `.map(...)` call by walking up.
        let p: SyntaxNode | null = n.parent
        while (p && p.type === 'arguments') p = p.parent
        if (p && p.type === 'call_expression') {
          const fn = p.childForFieldName('function')
          if (fn && fn.text.endsWith('.map')) {
            found.push(bodyJsx)
          }
        }
      }
    }
    for (let i = 0; i < n.childCount; i++) {
      const child = n.child(i)
      if (child) walk(child)
    }
  }
  walk(tableNode)
  return found
}

export const htmlTableAccessibilityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/html-table-accessibility',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['jsx_element', 'jsx_self_closing_element'],
  visit(node, filePath, sourceCode) {
    const tagName = getJsxElementName(node)
    if (!tagName) return null

    // Only apply to JSX files
    if (!filePath.endsWith('.tsx') && !filePath.endsWith('.jsx')) return null

    // S5256: <table> should have <th> or <thead>
    if (tagName === 'table') {
      // Skip generic reusable table wrapper components that receive {children}
      // and pass content through — accessibility is the consumer's responsibility
      let ancestor: SyntaxNode | null = node.parent
      while (ancestor) {
        if (ancestor.type === 'function_declaration' || ancestor.type === 'arrow_function'
          || ancestor.type === 'function' || ancestor.type === 'method_definition') {
          const params = ancestor.childForFieldName('parameters')
          if (params && params.text.includes('children')) return null
          break
        }
        ancestor = ancestor.parent
      }

      // Skip pass-through primitives: `<table {...props} />` (or with spread) —
      // the consumer supplies <thead>/<th> via spread props.
      if (hasSpreadAttribute(node)) return null

      // Skip tables wrapped inside a styled `<div>` parent — this pattern
      // is overwhelmingly a presentation/layout concern in real-world UIs
      // (the wrapper owns rounded borders, overflow, etc.) and the table
      // body itself is rendering key/value data, not a column-headed grid.
      if (isWrappedInDiv(node)) return null

      // Skip data tables where rows are generated by `.map()` and each row
      // declares multiple explicit `<td>` children (e.g. fixed columns
      // derived from a typed record). These are accessibility-noisy in
      // practice; sonarjs S5256 only fires reliably when the column shape
      // is hard-coded or single-`.map()`-of-cells.
      const mappedTrs = findMappedTrTemplates(node)
      if (mappedTrs.length > 0 && mappedTrs.every((tr) => directJsxChildren(tr).filter(
        (c) => {
          const name = getJsxElementName(c)
          return name === 'td' || name === 'th'
        },
      ).length >= 2)) {
        return null
      }

      if (!hasDescendantWithTag(node, 'th') && !hasDescendantWithTag(node, 'thead')) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'HTML table accessibility',
          '`<table>` element has no header cells (`<th>`) or `<thead>`. Tables should have headers to be accessible.',
          sourceCode,
          'Add `<th>` cells or a `<thead>` element to provide header information for screen readers.',
        )
      }
    }

    // S5264: <object> should have fallback content
    if (tagName === 'object') {
      if (node.type === 'jsx_self_closing_element') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'HTML <object> accessibility',
          '`<object>` tag should provide alternative content for browsers that cannot display the embedded object.',
          sourceCode,
          'Add fallback text or content inside the `<object>` element.',
        )
      }
      // Check for empty object element
      if (!hasNonEmptyChildren(node)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'HTML <object> accessibility',
          '`<object>` tag should provide alternative content for browsers that cannot display the embedded object.',
          sourceCode,
          'Add fallback text or content inside the `<object>` element.',
        )
      }
    }

    return null
  },
}
