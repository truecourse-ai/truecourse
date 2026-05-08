import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'
import { isFieldKeyArgument, isSubscriptIndex, isInZodEnumArray } from './_helpers.js'

export const duplicateStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/duplicate-string',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['program'],
  visit(node, filePath, sourceCode) {
    // First pass: collect every string literal value that appears inside
    // a TypeScript literal_type node. These are members of string-literal
    // union types — `type DialogState = 'PROMPT' | 'PROCESSING' | 'DONE'`,
    // `function f(t: 'count' | 'cumulative' = 'count')`, `z.enum([...])`,
    // etc. Default values, useState<X>('lit') generic arg defaults, and
    // function-arg literals matching one of these shapes can't be
    // extracted to a constant without breaking type narrowing.
    const literalTypeMembers = new Set<string>()
    function collectLiteralTypeMembers(n: SyntaxNode) {
      if (n.type === 'literal_type') {
        for (let i = 0; i < n.namedChildCount; i++) {
          const child = n.namedChild(i)
          if (child?.type === 'string') literalTypeMembers.add(child.text)
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectLiteralTypeMembers(child)
      }
    }
    collectLiteralTypeMembers(node)

    const stringCounts = new Map<string, { count: number; firstNode: SyntaxNode }>()

    function walk(n: SyntaxNode) {
      if (n.type === 'string') {
        const content = n.text
        if (content.length <= 5) return
        const parent = n.parent
        // Skip TypeScript type keywords (e.g., `string` inside `predefined_type`)
        if (parent?.type === 'predefined_type') return
        if (parent?.type === 'import_statement' || parent?.type === 'call_expression') return
        // Skip JSX attribute values (SVG props, className, Tailwind classes)
        if (parent?.type === 'jsx_attribute') return
        // Skip type annotations and type contexts
        if (parent?.type === 'type_annotation' || parent?.type === 'type_alias_declaration'
          || parent?.type === 'property_signature' || parent?.type === 'literal_type') return

        // Skip when the literal appears in a string-literal union
        // somewhere in the file. The literal is type-bound; extracting
        // it would break narrowing.
        if (literalTypeMembers.has(content)) return

        // Skip field-key arguments to form / storage / translation
        // libraries.
        if (isFieldKeyArgument(n)) return

        // Skip subscript indexes: `obj['key']` (computed key access).
        if (isSubscriptIndex(n)) return

        // Skip strings that are members of `z.enum([...])` arrays.
        if (isInZodEnumArray(n)) return

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
