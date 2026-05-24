import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

export const duplicateStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/duplicate-string',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    const stringCounts = new Map<string, { count: number; firstNode: SyntaxNode }>()

    function walk(n: SyntaxNode) {
      if (n.type === 'string') {
        const content = n.text
        if (content.length <= 5) return
        // Single-identifier tokens (e.g. 'json', 'number', 'error') are typically
        // framework API tokens, typeof return values, or status/kind discriminants —
        // not domain strings worth extracting to a constant.
        const inner = content.slice(1, -1)
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(inner)) return
        const parent = n.parent
        // Skip TypeScript type keywords (e.g., `string` inside `predefined_type`)
        if (parent?.type === 'predefined_type') return
        if (parent?.type === 'import_statement' || parent?.type === 'call_expression') return
        // Short kebab-case identifier-like tokens used as call/new arguments
        // (e.g. `.toString('utf-8')`, `.with('invalid-token', …)`,
        // `pingRegion('us-east-1')`) are framework / API tokens, not domain
        // strings worth extracting. Restrict to ≤2 hyphens (≤3 segments) so
        // longer kebab-spelled phrases still fire. Limit to the call-argument
        // position so duplicated kebab strings stored in variables still fire.
        if (parent?.type === 'arguments'
          && (parent.parent?.type === 'call_expression' || parent.parent?.type === 'new_expression')
          && /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(inner)
          && (inner.match(/-/g)?.length ?? 0) <= 2) return
        // Skip JSX attribute values (SVG props, className, Tailwind classes)
        if (parent?.type === 'jsx_attribute') return
        // Skip type annotations and type contexts
        if (parent?.type === 'type_annotation' || parent?.type === 'type_alias_declaration'
          || parent?.type === 'property_signature' || parent?.type === 'literal_type') return
        // Skip strings used as object literal property keys
        // (e.g. `{ 'Content-Type': 'application/json' }`) — the key
        // names the slot, it is not a domain string worth extracting.
        if (parent?.type === 'pair' && parent.childForFieldName('key')?.id === n.id) return
        // Skip dotted-identifier strings (e.g. `'Envelope.id'`,
        // `'User.email'`) — these are schema column / namespaced
        // identifier references, not domain strings.
        if (/^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)+$/.test(inner)) return

        const existing = stringCounts.get(content)
        if (existing) {
          existing.count++
        } else {
          stringCounts.set(content, { count: 1, firstNode: n })
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }

    walk(node)

    for (const [content, info] of stringCounts) {
      if (info.count >= 3) {
        return makeViolation(
          this.ruleKey, info.firstNode, filePath, 'low',
          'Duplicate string literal',
          `String ${content} appears ${info.count} times. Extract to a named constant.`,
          sourceCode,
          'Extract the repeated string into a constant variable.',
        )
      }
    }
    return null
  },
}
