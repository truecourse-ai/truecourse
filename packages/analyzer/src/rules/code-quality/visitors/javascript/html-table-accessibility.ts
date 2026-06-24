import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('web-tree-sitter').Node

/**
 * Accessibility rules for HTML tables in JSX:
 * - HTML tables should not be used for layout purposes
 * - tables should have header elements
 * - <object> tags should provide alternative content
 *
 * Detects:
 * 1. <table> without any <th> or <thead> elements
 * 2. <object> without fallback content
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
 * Returns true if the JSX element (or self-closing element) carries a JSX
 * spread attribute like `{...props}`. Such elements are typically generic
 * primitive wrappers that forward content (including children) from the
 * consumer — accessibility is the consumer's responsibility, not the
 * primitive's.
 */
function hasJsxSpreadAttribute(node: SyntaxNode): boolean {
  const attrParent =
    node.type === 'jsx_self_closing_element'
      ? node
      : (node.childForFieldName('open_tag') ?? node.children[0])
  if (!attrParent) return false
  for (const child of attrParent.namedChildren) {
    if (child.type === 'jsx_expression') {
      for (const inner of child.namedChildren) {
        if (inner.type === 'spread_element') return true
      }
    }
  }
  return false
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

    // <table> should have <th> or <thead>
    if (tagName === 'table') {
      // Skip generic reusable table wrapper components that forward content
      // via `{...props}` — accessibility is the consumer's responsibility.
      if (hasJsxSpreadAttribute(node)) return null

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

    // <object> should have fallback content
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
