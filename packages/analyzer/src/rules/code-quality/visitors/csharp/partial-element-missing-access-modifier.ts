import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

const ACCESS_MODIFIERS = new Set(['public', 'private', 'protected', 'internal'])

const PARTIAL_TYPES = [
  'class_declaration', 'struct_declaration', 'interface_declaration', 'record_declaration',
  'method_declaration',
]

function modifierTexts(node: SyntaxNode): string[] {
  return node.children.filter((c) => c?.type === 'modifier').map((c) => c!.text)
}

/**
 * A `partial` type or method part that states no access modifier on this part. The
 * accessibility is then declared only on another part (or defaulted), so a reader
 * of this file cannot tell how visible the element is. State the modifier on every
 * part. Interface members (implicitly public) and explicit interface
 * implementations are excluded.
 */
export const csharpPartialElementMissingAccessModifierVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/partial-element-missing-access-modifier',
  languages: ['csharp'],
  nodeTypes: PARTIAL_TYPES,
  visit(node, filePath, sourceCode) {
    const mods = modifierTexts(node)
    if (!mods.includes('partial')) return null
    if (mods.some((m) => ACCESS_MODIFIERS.has(m))) return null
    if (node.parent?.parent?.type === 'interface_declaration') return null

    if (node.type === 'method_declaration') {
      const nm = node.childForFieldName('name')
      if (nm?.type === 'qualified_name' || (nm?.text ?? '').includes('.')) return null
    }

    const target = node.childForFieldName('name') ?? node
    return makeViolation(
      this.ruleKey, target, filePath, 'low',
      'Partial element missing access modifier',
      'Partial declaration states no access modifier here, hiding its accessibility in another part; state it explicitly on every part.',
      sourceCode,
      'Add the access modifier to every part of the partial declaration.',
    )
  },
}
