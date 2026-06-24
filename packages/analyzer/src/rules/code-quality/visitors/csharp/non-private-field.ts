import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { getCSharpDeclAttributeNames, isCSharpGeneratedSource } from './_helpers.js'

/**
 * A class field exposed with `public`/`protected`/`internal` accessibility
 * breaks encapsulation: callers bind to the field directly, so it can never
 * gain validation, change notification, or a computed backing without a
 * breaking change — expose state through a property instead (SA1401).
 *
 * `const` and `static readonly` fields are immutable shared values, the
 * legitimate exception, and are not flagged. (An instance `readonly` field is
 * still flagged: a `readonly` reference to a mutable collection lets callers
 * mutate its contents, so the exposure smell remains.) Attribute-decorated
 * fields (serialization contracts, `[ThreadStatic]`) are left alone, as are
 * structs (interop/layout types routinely expose public fields).
 */
export const csharpNonPrivateFieldVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/non-private-field',
  languages: ['csharp'],
  nodeTypes: ['field_declaration'],
  visit(node, filePath, sourceCode) {
    if (isCSharpGeneratedSource(filePath, sourceCode)) return null

    // Only fields directly in a class body — struct fields are commonly public.
    if (node.parent?.parent?.type !== 'class_declaration') return null

    const exposed = ['public', 'protected', 'internal'].some((m) => hasCSharpModifier(node, m))
    if (!exposed) return null

    // Immutable shared values are the legitimate exception.
    if (hasCSharpModifier(node, 'const')) return null
    if (hasCSharpModifier(node, 'static') && hasCSharpModifier(node, 'readonly')) return null

    // Attribute-decorated fields are serialization/runtime contracts.
    if (getCSharpDeclAttributeNames(node).length > 0) return null

    const varDecl = node.namedChildren.find((c) => c?.type === 'variable_declaration')
    const firstDeclarator = varDecl?.namedChildren.find((c) => c?.type === 'variable_declarator')
    const nameNode: SyntaxNode = firstDeclarator?.childForFieldName('name') ?? node
    const name = firstDeclarator?.childForFieldName('name')?.text ?? 'field'

    return makeViolation(
      this.ruleKey, nameNode, filePath, 'medium',
      'Non-private field',
      `Field \`${name}\` is exposed with non-private accessibility, breaking encapsulation — expose the state through a property instead (SA1401).`,
      sourceCode,
      'Make the field `private` and surface it through a property.',
    )
  },
}
