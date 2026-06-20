import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const VISIBLE_MODIFIERS = new Set(['public', 'protected', 'internal'])

/**
 * A `static` field that is neither `const` nor `readonly` and is reachable
 * from outside the type (`public`, `protected`, or `internal`). It exposes
 * shared mutable state every caller can reassign without synchronization,
 * which races under concurrency and couples unrelated code through a global.
 *
 * `const` and `readonly` statics are immutable references and are fine, as are
 * `private` statics (the type controls all access). `protected internal` and
 * `private protected` both carry a visible modifier and are caught.
 */
export const csharpNonConstantStaticFieldVisibleVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/non-constant-static-field-visible',
  languages: ['csharp'],
  nodeTypes: ['field_declaration'],
  visit(node, filePath, sourceCode) {
    const modifiers = node.children.filter((c) => c?.type === 'modifier').map((c) => c!.text)
    if (!modifiers.includes('static')) return null
    if (modifiers.includes('const') || modifiers.includes('readonly')) return null
    if (!modifiers.some((m) => VISIBLE_MODIFIERS.has(m))) return null

    const decl = node.namedChildren.find((c) => c?.type === 'variable_declaration')
    const firstName = decl?.namedChildren
      .find((c) => c?.type === 'variable_declarator')
      ?.childForFieldName('name')?.text

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Externally visible mutable static field',
      `The static field \`${firstName ?? '?'}\` is neither const nor readonly yet is visible outside the type, exposing shared mutable state that any caller can reassign without synchronization.`,
      sourceCode,
      'Make the field `readonly` (or `const`), expose it through a property with controlled mutation, or reduce its visibility to `private`.',
    )
  },
}
