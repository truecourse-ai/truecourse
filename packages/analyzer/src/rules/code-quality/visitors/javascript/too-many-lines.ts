import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'

const JSX_NODE_TYPES = new Set(['jsx_element', 'jsx_self_closing_element', 'jsx_fragment'])

/**
 * Add to `markup` every line covered by a JSX element in the
 * subtree rooted at `node`. Embedded JS expressions inside JSX
 * (`{expr}`) are still counted as logic lines because they hold
 * actual code.
 */
function collectJsxLines(node: SyntaxNode, markup: Set<number>): void {
  if (JSX_NODE_TYPES.has(node.type)) {
    for (let row = node.startPosition.row; row <= node.endPosition.row; row++) {
      markup.add(row)
    }
    // Walk inside to subtract JS expression lines back out.
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (!child) continue
      if (child.type === 'jsx_expression') {
        for (let row = child.startPosition.row; row <= child.endPosition.row; row++) {
          markup.delete(row)
        }
      } else if (JSX_NODE_TYPES.has(child.type)) {
        collectJsxLines(child, markup)
      } else if (child.type === 'jsx_attribute') {
        // Attribute may contain a JSX expression: re-subtract.
        for (let j = 0; j < child.namedChildCount; j++) {
          const a = child.namedChild(j)
          if (a?.type === 'jsx_expression') {
            for (let row = a.startPosition.row; row <= a.endPosition.row; row++) {
              markup.delete(row)
            }
          }
        }
      }
    }
    return
  }
  for (let i = 0; i < node.namedChildCount; i++) {
    const child = node.namedChild(i)
    if (child) collectJsxLines(child, markup)
  }
}

export const tooManyLinesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/too-many-lines',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    const lineCount = bodyNode.endPosition.row - bodyNode.startPosition.row + 1
    if (lineCount <= 50) return null

    // Subtract JSX markup lines. A 200-line render body that is
    // mostly markup is structural, not logic complexity.
    const markup = new Set<number>()
    collectJsxLines(bodyNode, markup)
    const logicLines = lineCount - markup.size
    if (logicLines <= 50) return null

    const name = getFunctionName(node)
    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Function too long',
      `Function \`${name}\` has ${logicLines} non-markup lines (max 50). Split into smaller, focused functions.`,
      sourceCode,
      'Extract logical sections into separate helper functions.',
    )
  },
}
