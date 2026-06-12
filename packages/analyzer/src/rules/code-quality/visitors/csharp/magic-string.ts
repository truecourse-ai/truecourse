import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpStringText } from '../../../_shared/csharp-helpers.js'

const MIN_LENGTH = 4
const MIN_OCCURRENCES = 3

/**
 * Shared filter for repeated-string rules. Returns the string content when
 * the literal is a candidate, or null when it sits in a position where
 * repeating it is idiomatic C#.
 */
export function csharpRepeatedStringCandidate(n: SyntaxNode): string | null {
  if (n.type !== 'string_literal') return null
  const inner = getCSharpStringText(n)
  if (!inner) return null

  // Single-identifier tokens ('json', 'error') are API/kind discriminants.
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(inner)) return null
  // Dotted identifiers ('Order.Id', 'System.Text') are member/config paths.
  if (/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(inner)) return null

  const parent = n.parent
  // Attribute arguments ([Route("api/orders")], [Display(Name = "…")]) are
  // declarative metadata, not extractable domain strings.
  if (parent?.type === 'attribute_argument') return null
  // Short kebab/identifier-ish tokens passed straight to a call
  // (`.GetSection("connection-strings")`, `AddPolicy("read-only", …)`) are
  // framework tokens.
  if (parent?.type === 'argument'
    && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(inner)
    && (inner.match(/-/g)?.length ?? 0) <= 2) return null

  return inner
}

export const csharpMagicStringVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/magic-string',
  languages: ['csharp'],
  nodeTypes: ['compilation_unit'],
  visit(node, filePath, sourceCode) {
    const counts = new Map<string, SyntaxNode[]>()

    function walk(n: SyntaxNode) {
      const inner = csharpRepeatedStringCandidate(n)
      if (inner !== null && inner.length >= MIN_LENGTH && /^[a-zA-Z]/.test(inner)) {
        const existing = counts.get(inner) ?? []
        existing.push(n)
        counts.set(inner, existing)
      }
      for (let i = 0; i < n.namedChildCount; i++) {
        const child = n.namedChild(i)
        if (child) walk(child)
      }
    }

    walk(node)

    for (const [text, nodes] of counts) {
      if (nodes.length >= MIN_OCCURRENCES) {
        return makeViolation(
          this.ruleKey, nodes[0]!, filePath, 'low',
          'Magic string without named constant',
          `String literal \`"${text}"\` appears ${nodes.length} times — extract to a named constant.`,
          sourceCode,
          `Extract \`"${text}"\` to a named constant: \`private const string MyString = "${text}";\`.`,
        )
      }
    }
    return null
  },
}
