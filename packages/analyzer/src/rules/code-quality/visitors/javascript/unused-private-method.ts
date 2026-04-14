import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { SyntaxNode } from 'tree-sitter'

/**
 * Detects private class methods that are never called within the class body.
 * Works by AST analysis: finds methods with `private` accessibility modifier
 * or `#name` private field syntax, then checks if they are called anywhere
 * in the class body.
 */
export const unusedPrivateMethodVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unused-private-method',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['class_declaration', 'class'],
  visit(node, filePath, sourceCode) {
    const body = node.namedChildren.find((c) => c.type === 'class_body')
    if (!body) return null

    // Collect private methods: name → nameNode
    const privateMethods = new Map<string, SyntaxNode>()
    for (const member of body.namedChildren) {
      if (member.type !== 'method_definition') continue
      const isPrivate =
        member.children.some((c) => c.type === 'accessibility_modifier' && c.text === 'private') ||
        member.children.some((c) => c.type === 'private_property_identifier')
      if (!isPrivate) continue
      const nameNode = member.children.find(
        (c) => c.type === 'property_identifier' || c.type === 'private_property_identifier',
      )
      if (!nameNode) continue
      const name = nameNode.text.replace(/^#/, '')
      // Don't flag constructor, getters/setters
      const isStatic = member.children.some((c) => c.text === 'static')
      const kind = member.children.find((c) => c.type === 'property_identifier' || c.type === 'private_property_identifier')
      // Skip getters/setters — they are "called" implicitly
      const hasGetSet = member.children.some((c) => c.text === 'get' || c.text === 'set')
      if (hasGetSet) continue
      if (!isStatic || name !== 'constructor') {
        privateMethods.set(name, nameNode)
      }
    }

    if (privateMethods.size === 0) return null

    // Collect all method call names in the class body
    const calledNames = new Set<string>()
    function collectCalls(n: SyntaxNode) {
      if (n.type === 'call_expression') {
        const func = n.childForFieldName('function')
        if (func) {
          if (func.type === 'member_expression') {
            const obj = func.childForFieldName('object')
            const prop = func.childForFieldName('property')
            if ((obj?.text === 'this' || obj?.type === 'this') && prop) {
              calledNames.add(prop.text.replace(/^#/, ''))
            }
          } else if (func.type === 'private_property_identifier') {
            calledNames.add(func.text.replace(/^#/, ''))
          }
        }
      }
      // Also track private_property_identifier reads (e.g., passing as callback)
      if (n.type === 'private_property_identifier') {
        calledNames.add(n.text.replace(/^#/, ''))
      }
      if (n.type === 'member_expression') {
        const obj = n.childForFieldName('object')
        const prop = n.childForFieldName('property')
        if ((obj?.text === 'this' || obj?.type === 'this') && prop) {
          // Check if parent is a call_expression — if not, still a "read"
          if (n.parent?.type !== 'call_expression' || n.parent.childForFieldName('function') !== n) {
            calledNames.add(prop.text.replace(/^#/, ''))
          }
        }
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectCalls(child)
      }
    }
    collectCalls(body)

    for (const [name, nameNode] of privateMethods) {
      if (!calledNames.has(name)) {
        return makeViolation(
          this.ruleKey,
          nameNode,
          filePath,
          'low',
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
