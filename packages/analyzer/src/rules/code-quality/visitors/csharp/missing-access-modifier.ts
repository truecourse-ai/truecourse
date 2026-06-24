import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const ACCESS_MODIFIERS = new Set(['public', 'private', 'protected', 'internal'])

const MEMBER_TYPES = [
  'class_declaration', 'struct_declaration', 'interface_declaration', 'record_declaration',
  'enum_declaration', 'delegate_declaration', 'field_declaration', 'property_declaration',
  'event_declaration', 'event_field_declaration', 'indexer_declaration',
  'method_declaration', 'constructor_declaration',
]

function modifierTexts(node: SyntaxNode): string[] {
  return node.children.filter((c) => c?.type === 'modifier').map((c) => c!.text)
}

function declNameNode(node: SyntaxNode): SyntaxNode {
  if (node.type === 'field_declaration' || node.type === 'event_field_declaration') {
    const decl = node.namedChildren.find((c) => c?.type === 'variable_declaration')
    const declarator = decl?.namedChildren.find((c) => c?.type === 'variable_declarator')
    return declarator?.childForFieldName('name') ?? node
  }
  return node.childForFieldName('name') ?? node
}

/**
 * A type or member that declares no explicit access modifier, leaving its
 * accessibility to language defaults (internal for top-level types, private for
 * members) — easy to misread and easy to widen by accident. Interface members
 * (implicitly public), enum constants, explicit interface implementations and
 * static constructors take no access modifier and are never flagged; `partial`
 * declarations are covered by partial-element-missing-access-modifier.
 */
export const csharpMissingAccessModifierVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/missing-access-modifier',
  languages: ['csharp'],
  nodeTypes: MEMBER_TYPES,
  visit(node, filePath, sourceCode) {
    const mods = modifierTexts(node)
    if (mods.some((m) => ACCESS_MODIFIERS.has(m))) return null
    if (mods.includes('partial')) return null

    // Members of an interface are implicitly public.
    if (node.parent?.parent?.type === 'interface_declaration') return null

    if (node.type === 'method_declaration') {
      // Explicit interface implementations (`void IFoo.Bar()`) take no modifier.
      const nm = node.childForFieldName('name')
      if (nm?.type === 'qualified_name' || (nm?.text ?? '').includes('.')) return null
      if (node.namedChildren.some((c) => c?.type === 'explicit_interface_specifier')) return null
    }
    if (node.type === 'constructor_declaration' && mods.includes('static')) return null

    const target = declNameNode(node)
    return makeViolation(
      this.ruleKey, target, filePath, 'low',
      'Missing access modifier',
      'Declaration has no explicit access modifier; add one to make its accessibility unambiguous.',
      sourceCode,
      'Add an explicit access modifier (public/internal/protected/private).',
    )
  },
}
