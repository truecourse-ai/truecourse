import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const INITIALIZER_STOPS = new Set(['block', 'arrow_expression_clause', 'method_declaration', 'constructor_declaration', 'accessor_declaration'])

// Composition roots fail fast at startup by design — `Configuration[…]!` is
// the pattern Microsoft's own project templates ship. Request-path code is
// where a dodged null check becomes a runtime 500, so only startup wiring
// files are exempt.
const COMPOSITION_ROOT_FILE = /(^|[/\\])(Program|Startup)\.cs$|Dependenc|DependencyInjection|ServiceCollectionExtensions/

/**
 * Null-forgiving `!` on an expression — silences the nullable checker the
 * same way the TS non-null assertion does, trading a compile-time warning
 * for a potential runtime NullReferenceException.
 *
 * Idiomatic declarations are excluded: `= null!` / `= default!` (the
 * standard non-nullable DTO/EF initializer) and any `!` inside a field,
 * property, or parameter initializer.
 */
export const csharpNonNullAssertionVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/non-null-assertion',
  languages: ['csharp'],
  nodeTypes: ['postfix_unary_expression'],
  visit(node, filePath, sourceCode) {
    if (!node.children.some((c) => c?.type === '!')) return null
    if (COMPOSITION_ROOT_FILE.test(filePath)) return null

    const operand = node.namedChildren[0]
    if (!operand) return null
    // `null!` / `default!` declare intent rather than dodge a check.
    if (operand.type === 'null_literal' || operand.type === 'default_expression' || operand.text === 'default') return null

    // Field/property/parameter initializers (`= JsonSerializer.Deserialize(…)!;`
    // at declaration level) are the established nullable-bootstrap idiom.
    let current = node.parent
    while (current) {
      if (INITIALIZER_STOPS.has(current.type)) break
      if (current.type === 'field_declaration' || current.type === 'property_declaration'
        || current.type === 'parameter') return null
      current = current.parent
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Null-forgiving operator',
      `\`${node.text.length > 60 ? `${node.text.slice(0, 57)}…` : node.text}\` suppresses the nullable check — if the value is ever null this becomes a runtime NullReferenceException.`,
      sourceCode,
      'Prove non-nullness instead: a null check, pattern match (`is not null`), `?.` with a fallback, or `?? throw` with a descriptive message.',
    )
  },
}
