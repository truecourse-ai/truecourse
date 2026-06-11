import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { getCSharpDeclAttributeNames, isCSharpGeneratedSource, isCSharpPrivateMember } from './_helpers.js'

const NESTED_TYPE_KINDS = new Set(['class_declaration', 'struct_declaration', 'record_declaration'])

export const csharpUnusedPrivateNestedClassVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-private-nested-class',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    // Only inspect outer (non-nested) classes so each nested type is
    // evaluated exactly once against its declaring class's body. Namespace
    // bodies are also declaration_lists, so test the ancestor's kind.
    for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
      if (ancestor.type === 'class_declaration' || ancestor.type === 'struct_declaration'
        || ancestor.type === 'record_declaration') return null
    }
    if (isCSharpGeneratedSource(filePath, sourceCode)) return null
    if (hasCSharpModifier(node, 'partial')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const privateClasses = new Map<string, SyntaxNode>()
    for (const member of body.namedChildren) {
      if (!member || !NESTED_TYPE_KINDS.has(member.type)) continue
      // Nested types default to private when no accessibility is given.
      if (!isCSharpPrivateMember(member)) continue
      if (hasCSharpModifier(member, 'partial')) continue
      // [JsonSerializable], test data sources, … are reached via reflection.
      if (getCSharpDeclAttributeNames(member).length > 0) continue
      const nameNode = member.childForFieldName('name')
      if (nameNode) privateClasses.set(nameNode.text, nameNode)
    }

    if (privateClasses.size === 0) return null

    const declIds = new Map<string, number>()
    for (const [name, nameNode] of privateClasses) declIds.set(name, nameNode.id)

    const referenced = new Set<string>()
    function walk(n: SyntaxNode) {
      if (n.type === 'identifier') {
        const declId = declIds.get(n.text)
        if (declId !== undefined && n.id !== declId) referenced.add(n.text)
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }
    walk(body)

    for (const [name, nameNode] of privateClasses) {
      if (!referenced.has(name)) {
        return makeViolation(
          this.ruleKey, nameNode, filePath, 'low',
          'Unused private nested class',
          `Private nested type \`${name}\` is never referenced. Remove it or use it.`,
          sourceCode,
          'Remove the unused private nested type or add a reference to it.',
        )
      }
    }
    return null
  },
}
