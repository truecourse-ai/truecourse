import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const nestedTemplateLiteralVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nested-template-literal',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['template_string'],
  visit(node, filePath, sourceCode) {
    // Skip tagged templates whose tag is a known i18n / DSL identifier.
    // For `msg`...``, `t`...``, `gql`...``, etc. the nested literal inside
    // a substitution is a convention (formatting a value before it joins
    // the translated/queried message), not a readability hazard.
    const parent = node.parent
    if (parent?.type === 'call_expression') {
      const fn = parent.childForFieldName('function')
      const tagName = fn?.type === 'identifier' ? fn.text : null
      if (tagName && /^(msg|t|jt|defineMessage|plural|select|selectOrdinal|gql|css|html|sql|graphql)$/.test(tagName)) {
        return null
      }
    }
    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === 'template_substitution') {
        function hasNestedTemplate(n: SyntaxNode): boolean {
          if (n.type === 'template_string') return true
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
