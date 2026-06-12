import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { hasCSharpModifier } from '../../../_shared/csharp-helpers.js'
import { getCSharpDeclAttributeNames, isCSharpGeneratedSource, isCSharpPrivateMember } from './_helpers.js'

export const csharpUnusedPrivateMethodVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-private-method',
  languages: ['csharp'],
  nodeTypes: ['class_declaration'],
  visit(node, filePath, sourceCode) {
    if (isCSharpGeneratedSource(filePath, sourceCode)) return null
    if (hasCSharpModifier(node, 'partial')) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    const privateMethods = new Map<string, SyntaxNode>()
    for (const member of body.namedChildren) {
      if (member?.type !== 'method_declaration') continue
      if (!isCSharpPrivateMember(member)) continue
      // Attribute-decorated methods (test hooks, [GeneratedRegex] partials,
      // serialization callbacks) are invoked by frameworks.
      if (getCSharpDeclAttributeNames(member).length > 0) continue
      // Partial method halves and explicit interface implementations are
      // invoked from elsewhere.
      if (hasCSharpModifier(member, 'partial') || hasCSharpModifier(member, 'extern')) continue
      if (member.namedChildren.some((c) => c?.type === 'explicit_interface_specifier')) continue
      const nameNode = member.childForFieldName('name')
      if (!nameNode || nameNode.text === 'Main') continue
      privateMethods.set(nameNode.text, nameNode)
    }

    if (privateMethods.size === 0) return null

    // Any identifier occurrence other than the declaration name counts —
    // direct calls, method-group references (`items.Where(Filter)`),
    // delegate subscriptions, and `nameof(...)`.
    const declIds = new Map<string, number>()
    for (const [name, nameNode] of privateMethods) declIds.set(name, nameNode.id)

    const used = new Set<string>()
    function walk(n: SyntaxNode) {
      if (n.type === 'identifier') {
        const declId = declIds.get(n.text)
        if (declId !== undefined && n.id !== declId) used.add(n.text)
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) walk(child)
      }
    }
    walk(body)

    for (const [name, nameNode] of privateMethods) {
      if (!used.has(name)) {
        return makeViolation(
          this.ruleKey, nameNode, filePath, 'low',
          'Unused private method',
          `Private method \`${name}\` is never called. Remove it or call it somewhere in the class.`,
          sourceCode,
          'Remove the unused private method or add a call to it.',
        )
      }
    }
    return null
  },
}
