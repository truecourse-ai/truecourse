import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

// Minimum string length to be considered "magic"
const MIN_LENGTH = 4
// Minimum occurrences to flag
const MIN_OCCURRENCES = 3

export const magicStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/magic-string',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node: SyntaxNode, filePath, sourceCode) {
    const counts = new Map<string, SyntaxNode[]>()

    function walk(n: SyntaxNode) {
      if (n.type === 'string' || n.type === 'template_string') {
        // Only plain strings, not template literals with expressions
        if (n.type === 'string') {
          // Skip TypeScript type keywords (e.g., `string` inside `predefined_type`)
          if (n.parent?.type === 'predefined_type') return
          // Skip type annotation contexts
          if (n.parent?.type === 'type_annotation' || n.parent?.type === 'literal_type'
            || n.parent?.type === 'property_signature') return
          // Skip JSX attribute values (Tailwind CSS classes, className, etc.)
          if (n.parent?.type === 'jsx_attribute') return
          // Skip strings inside JSX expression containers that are attribute values
          if (n.parent?.type === 'jsx_expression' && n.parent.parent?.type === 'jsx_attribute') return
          const text = n.text
          const inner = text.slice(1, -1) // strip quotes
          // Only flag non-trivial strings
          if (inner.length >= MIN_LENGTH && /^[a-zA-Z]/.test(inner) && !inner.includes('${')) {
            const existing = counts.get(text) ?? []
            existing.push(n)
            counts.set(text, existing)
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(node)

    for (const [text, nodes] of counts) {
      if (nodes.length >= MIN_OCCURRENCES) {
        const inner = text.slice(1, -1)
        return makeViolation(
          this.ruleKey, nodes[0], filePath, 'low',
          'Magic string without named constant',
          `String literal \`${text}\` appears ${nodes.length} times — extract to a named constant.`,
          sourceCode,
          `Extract \`${text}\` to a named constant: \`const MY_STRING = ${text};\`.`,
        )
      }
    }
    return null
  },
}
