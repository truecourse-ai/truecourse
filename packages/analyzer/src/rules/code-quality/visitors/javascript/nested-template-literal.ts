import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const nestedTemplateLiteralVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nested-template-literal',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['template_string'],
  visit(node, filePath, sourceCode) {
    // Skip if any ancestor is a tagged template (msg`...`, styled.div`...`,
    // css`...`). The tree-sitter TS grammar represents tagged templates as a
    // `call_expression` whose direct named children include a `template_string`
    // (instead of an `arguments` node).
    function isTaggedCall(n: SyntaxNode): boolean {
      if (n.type !== 'call_expression') return false
      for (let k = 0; k < n.namedChildCount; k++) {
        if (n.namedChild(k)?.type === 'template_string') return true
      }
      return false
    }
    let anc: SyntaxNode | null = node.parent
    while (anc) {
      if (anc.type === 'tagged_template_expression' || isTaggedCall(anc)) return null
      anc = anc.parent
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === 'template_substitution') {
        // Skip wrappers where nested template is intentional:
        // - ternary_expression: conditional URL/text shape
        // - call_expression: function-call argument (encodeURIComponent, etc.)
        // - tagged_template_expression: i18n macros (msg`...`), styled-components
        const SKIP_WRAPPER_TYPES = new Set([
          'ternary_expression',
          'call_expression',
          'tagged_template_expression',
          // tree-sitter TS represents tagged templates as call_expression too;
          // this covers both shapes.
        ])
        function hasNestedTemplate(n: SyntaxNode): boolean {
          if (n.type === 'template_string') return true
          if (SKIP_WRAPPER_TYPES.has(n.type)) return false
          for (let j = 0; j < n.namedChildCount; j++) {
            const c = n.namedChild(j)
            if (c && hasNestedTemplate(c)) return true
          }
          return false
        }
        if (hasNestedTemplate(child)) {
          return makeViolation(
            this.ruleKey, node, filePath, 'medium',
            'Nested template literal',
            'Template literal inside another template literal is hard to read. Extract the inner expression to a variable.',
            sourceCode,
            'Extract the inner template literal to a variable.',
          )
        }
      }
    }
    return null
  },
}
