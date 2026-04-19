import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getPythonModuleNode } from '../../../_shared/python-helpers.js'

/** Check if a class body contains a `__slots__` assignment. */
function bodyHasSlotsAssignment(body: SyntaxNode): boolean {
  for (const child of body.namedChildren) {
    if (child.type === 'expression_statement') {
      const expr = child.namedChildren[0]
      if (expr?.type === 'assignment') {
        const left = expr.childForFieldName('left')
        if (left?.type === 'identifier' && left.text === '__slots__') return true
      }
    }
    if (child.type === 'assignment') {
      const left = child.childForFieldName('left')
      if (left?.type === 'identifier' && left.text === '__slots__') return true
    }
  }
  return false
}

/** Check if a class body contains any `self.xxx` attribute access. */
function bodyHasSelfAttribute(body: SyntaxNode): boolean {
  return walkForSelfAttr(body)
}

function walkForSelfAttr(node: SyntaxNode): boolean {
  if (node.type === 'attribute') {
    const obj = node.childForFieldName('object')
    if (obj?.type === 'identifier' && obj.text === 'self') return true
  }
  for (const child of node.namedChildren) {
    if (walkForSelfAttr(child)) return true
  }
  return false
}

/** Find a top-level class by name in the module and check if its body has __slots__. */
function parentClassHasSlots(moduleNode: SyntaxNode, parentName: string): boolean {
  for (const child of moduleNode.namedChildren) {
    const classDef = child.type === 'decorated_definition'
      ? child.namedChildren.find((c) => c.type === 'class_definition')
      : child.type === 'class_definition' ? child : null
    if (!classDef) continue
    const name = classDef.childForFieldName('name')
    if (name?.text !== parentName) continue
    const body = classDef.childForFieldName('body')
    if (body && bodyHasSlotsAssignment(body)) return true
  }
  return false
}

export const missingSlotsInSubclassVisitor: CodeRuleVisitor = {
  ruleKey: 'performance/deterministic/missing-slots-in-subclass',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    // Check if class has a superclass
    const superclasses = node.childForFieldName('superclasses')
    if (!superclasses || superclasses.namedChildren.length === 0) return null

    const body = node.childForFieldName('body')
    if (!body) return null

    // Check if this class already defines __slots__
    if (bodyHasSlotsAssignment(body)) return null

    // Only flag if the class defines instance attributes (self.xxx)
    if (!bodyHasSelfAttribute(body)) return null

    // Check if any parent class in the same file defines __slots__
    const parentNames = superclasses.namedChildren.map((c) => c.text)
    const moduleNode = getPythonModuleNode(node)
    for (const parentName of parentNames) {
      if (parentClassHasSlots(moduleNode, parentName)) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Subclass missing __slots__',
          `Class inherits from ${parentName} which uses __slots__, but does not define its own __slots__. This negates the memory savings of __slots__.`,
          sourceCode,
          'Add __slots__ to the subclass listing any new attributes it defines.',
        )
      }
    }

    return null
  },
}
