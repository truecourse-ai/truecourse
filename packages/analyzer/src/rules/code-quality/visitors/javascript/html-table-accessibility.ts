import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

type SyntaxNode = import('tree-sitter').SyntaxNode

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
