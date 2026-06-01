import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

// JSX node types that wrap an embedded TS/JS expression. `cond && <X/>` and
// `cond ? <A/> : <B/>` inside JSX are conditional-render idioms, not real
// cognitive complexity — they're the React equivalent of writing two
// templates. Skip increments when we're inside one of these (but still
// inside the same outer function).
const JSX_EXPRESSION_TYPES = new Set([
  'jsx_expression',          // {expr} attribute / child
  'jsx_attribute',           // attr={expr}
])

function isInsideJsxExpression(node: SyntaxNode, functionNodeId: number): boolean {
  let cur: SyntaxNode | null = node.parent
  while (cur && cur.id !== functionNodeId) {
    if (JSX_EXPRESSION_TYPES.has(cur.type)) return true
    if (JS_FUNCTION_TYPES.includes(cur.type)) return false
    cur = cur.parent
  }
  return false
}

export const cognitiveComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/cognitive-complexity',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    let complexity = 0
    const NESTING_TYPES = new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_statement', 'catch_clause', 'ternary_expression'])
    const INCREMENT_TYPES = new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'switch_statement', 'catch_clause', 'ternary_expression'])

    function walk(n: SyntaxNode, nesting: number) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) return

      if (INCREMENT_TYPES.has(n.type)) {
        // Ternaries inside JSX (`{cond ? <A/> : <B/>}`) are conditional-render
        // structure, not control flow worth counting.
        if (n.type === 'ternary_expression' && isInsideJsxExpression(n, node.id)) {
          // intentionally don't count
        } else {
          complexity += 1 + nesting
        }
      }
      if (n.type === 'else_clause') {
        complexity += 1
      }
      if (n.type === 'binary_expression') {
        const op = n.children.find((c) => c.type === '&&' || c.type === '||')
        // `cond && <X/>` / `cond || <X/>` inside JSX is the standard
        // conditional-render idiom. Don't charge complexity for it.
        if (op && !isInsideJsxExpression(n, node.id)) complexity += 1
      }

      const nextNesting = NESTING_TYPES.has(n.type) ? nesting + 1 : nesting
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child, nextNesting)
      }
    }

    walk(bodyNode, 0)

    if (complexity > 15) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'High cognitive complexity',
        `Function \`${name}\` has cognitive complexity ${complexity} (max 15). Simplify by extracting helper functions or reducing nesting.`,
        sourceCode,
        'Break the function into smaller, focused helper functions.',
      )
    }
    return null
  },
}
