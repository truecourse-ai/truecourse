import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects __slots__ in a subclass that redefines slots already defined
 * in the parent class (within the same file).
 * This causes duplicated slot behavior and wasted memory.
 */
export const pythonRedefinedSlotsInSubclassVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/redefined-slots-in-subclass',
  languages: ['python'],
  nodeTypes: ['class_definition'],
  visit(node, filePath, sourceCode) {
    // Get class name and base classes
    const bases = node.childForFieldName('superclasses')
    if (!bases) return null

    const baseNames: string[] = []
    for (const child of bases.namedChildren) {
      if (child.type === 'identifier' || child.type === 'attribute') {
        baseNames.push(child.text)
      }
    }
    if (baseNames.length === 0) return null

    // Get __slots__ in this class
    const body = node.childForFieldName('body')
    if (!body) return null

    const childSlots = getSlotsValues(body)
    if (childSlots.length === 0) return null

    // Look for parent classes in the same file and get their __slots__
    const root = findRoot(node)
    if (!root) return null

    for (const baseName of baseNames) {
      const parentSlots = findClassSlots(root, baseName)
      if (parentSlots.length === 0) continue

      const parentSlotSet = new Set(parentSlots)
      const duplicates = childSlots.filter((s) => parentSlotSet.has(s))

      if (duplicates.length > 0) {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Redefined __slots__ in subclass',
          `__slots__ in subclass redefines '${duplicates.join("', '")}' from parent class '${baseName}' — causes duplicated slot behavior.`,
          sourceCode,
          'Remove the duplicate slot names from the subclass __slots__.',
        )
      }
    }

    return null
  },
}

function getSlotsValues(body: SyntaxNode): string[] {
  const slots: string[] = []
  for (let i = 0; i < body.childCount; i++) {
    const child = body.child(i)
    if (!child) continue

    if (child.type === 'expression_statement') {
      const expr = child.namedChildren[0]
      if (!expr || expr.type !== 'assignment') continue

      const left = expr.childForFieldName('left')
      if (!left || left.text !== '__slots__') continue

      const right = expr.childForFieldName('right')
      if (!right) continue

      // Extract slot names from tuple, list, or set
      extractStringLiterals(right, slots)
    }
  }
  return slots
}

function extractStringLiterals(node: SyntaxNode, result: string[]): void {
  if (node.type === 'string') {
    const text = node.text
    const match = text.match(/^['"](.*?)['"]$/)
    if (match) result.push(match[1])
    return
  }
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (child) extractStringLiterals(child, result)
  }
}

function findRoot(node: SyntaxNode): SyntaxNode {
  let current = node
  while (current.parent) current = current.parent
  return current
}

function findClassSlots(root: SyntaxNode, className: string): string[] {
  if (root.type === 'class_definition') {
    const nameNode = root.childForFieldName('name')
    if (nameNode && nameNode.text === className) {
      const body = root.childForFieldName('body')
      if (body) return getSlotsValues(body)
    }
  }
  for (let i = 0; i < root.childCount; i++) {
    const child = root.child(i)
    if (child) {
      const result = findClassSlots(child, className)
      if (result.length > 0) return result
    }
  }
  return []
}
