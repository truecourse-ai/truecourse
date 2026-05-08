import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

/**
 * True if `n` (a `template_string`) is the body of a tagged
 * template expression — `msg\`...\``, `gql\`...\``, `css\`...\``,
 * `i18n.t\`...\``. Tagged templates are library DSLs whose
 * literal body is the macro's compile-time extraction surface;
 * extracting to a variable would break the macro.
 *
 * tree-sitter shape: a tagged template renders as a
 * `call_expression` whose `function` is the tag and whose only
 * argument-like child is a `template_string`.
 */
function isTaggedTemplateBody(n: SyntaxNode): boolean {
  const parent = n.parent
  if (!parent) return false
  if (parent.type !== 'call_expression') return false
  // tree-sitter typescript: a tagged template `tag\`...\`` parses
  // as call_expression whose `arguments` field IS the template_string
  // itself (not wrapped in an `arguments` node). Identify the tagged
  // shape by the parent call's arguments field === this node.
  const args = parent.childForFieldName('arguments')
  if (args?.id === n.id) return true
  return false
}

export const nestedTemplateLiteralVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/nested-template-literal',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['template_string'],
  visit(node, filePath, sourceCode) {
    function hasNestedNonTaggedTemplate(n: SyntaxNode): boolean {
      if (n.type === 'template_string' && n.id !== node.id) {
        if (isTaggedTemplateBody(n)) return false
        return true
      }
      for (let j = 0; j < n.namedChildCount; j++) {
        const c = n.namedChild(j)
        if (c && hasNestedNonTaggedTemplate(c)) return true
      }
      return false
    }

    for (let i = 0; i < node.namedChildCount; i++) {
      const child = node.namedChild(i)
      if (child?.type === 'template_substitution') {
        if (hasNestedNonTaggedTemplate(child)) {
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
