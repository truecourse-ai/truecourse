import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpUsingSources } from '../../../_shared/csharp-framework-detection.js'

/**
 * A MEF <c>[Export]</c> on a type with no <c>[PartCreationPolicy]</c> (S4428). Without it
 * the part's lifetime is left to the importer/container default, so the same export can
 * be a single shared instance in one composition and a fresh instance in another — a
 * subtle source of state-sharing bugs. Declaring the policy makes the contract explicit.
 * Matched by attribute name under a <c>System.ComponentModel.Composition</c> using, so an
 * unrelated <c>[Export]</c> attribute never trips it.
 */
export const csharpMefExportMissingCreationPolicyVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/mef-export-missing-creation-policy',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    const attrs = attributeNames(node)
    if (!attrs.includes('Export') && !attrs.includes('InheritedExport')) return null
    if (attrs.includes('PartCreationPolicy')) return null
    if (!usesMef(node)) return null

    const name = node.childForFieldName('name')
    return makeViolation(
      this.ruleKey, name ?? node, filePath, 'medium',
      'MEF [Export] without [PartCreationPolicy]',
      `'${name?.text ?? ''}' is exported with [Export] but no [PartCreationPolicy], leaving its lifetime ambiguous between shared and non-shared across compositions.`,
      sourceCode,
      'Add [PartCreationPolicy(CreationPolicy.Shared)] or [PartCreationPolicy(CreationPolicy.NonShared)] to make the lifetime explicit.',
    )
  },
}

function usesMef(node: SyntaxNode): boolean {
  return [...getCSharpUsingSources(node)].some(
    (s) => s === 'System.ComponentModel.Composition' || s.startsWith('System.ComponentModel.Composition.'),
  )
}

function attributeNames(node: SyntaxNode): string[] {
  const names: string[] = []
  for (const child of node.children) {
    if (child?.type !== 'attribute_list') continue
    for (const attr of child.namedChildren) {
      if (attr?.type !== 'attribute') continue
      const n = attr.childForFieldName('name')?.text
      if (n) names.push((n.split('.').pop() ?? n).replace(/Attribute$/, ''))
    }
  }
  return names
}
