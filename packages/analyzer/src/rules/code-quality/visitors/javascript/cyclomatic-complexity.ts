import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_FUNCTION_TYPES, getFunctionBody, getFunctionName } from './_helpers.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const cyclomaticComplexityVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/cyclomatic-complexity',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: JS_FUNCTION_TYPES,
  visit(node, filePath, sourceCode) {
    const bodyNode = getFunctionBody(node)
    if (!bodyNode) return null

    let complexity = 1
    const DECISION_TYPES = new Set(['if_statement', 'for_statement', 'for_in_statement', 'while_statement', 'do_statement', 'catch_clause', 'ternary_expression'])

    function walk(n: SyntaxNode, inJsxExpr: boolean) {
      if (JS_FUNCTION_TYPES.includes(n.type) && n.id !== node.id) return
      const childInJsxExpr = inJsxExpr || n.type === 'jsx_expression'
      if (DECISION_TYPES.has(n.type)) {
        // Conditional-rendering ternaries inside JSX expressions (`{x ? <A/> : <B/>}`)
        // are presentation, not imperative branching — don't inflate complexity.
        if (!(n.type === 'ternary_expression' && childInJsxExpr)) complexity++
      }
      if (n.type === 'switch_case') complexity++
      if (n.type === 'binary_expression') {
        const op = n.children.find((c) => c.type === '&&' || c.type === '||')
        // Short-circuit operators inside a JSX expression (`{cond && <Foo/>}`,
        // `{a ?? b}`) are the canonical conditional-render idiom; skip them
        // the same way as the ternary above.
        if (op && !childInJsxExpr) complexity++
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child, childInJsxExpr)
      }
    }

    walk(bodyNode, false)

    if (complexity > 10) {
      const name = getFunctionName(node)
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'High cyclomatic complexity',
        `Function \`${name}\` has cyclomatic complexity ${complexity} (max 10). Consider splitting into smaller functions.`,
        sourceCode,
        'Reduce decision points by extracting logic into helper functions or using lookup tables.',
      )
    }
    return null
  },
}
