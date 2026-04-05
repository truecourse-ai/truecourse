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
