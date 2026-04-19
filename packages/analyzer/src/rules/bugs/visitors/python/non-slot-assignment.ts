import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Detect: assigning to self.attr where attr is not in __slots__

function getSlotsFromClass(classNode: SyntaxNode): Set<string> | null {
  const body = classNode.childForFieldName('body')
  if (!body) return null

  let slotsFound = false
  const slots = new Set<string>()

  for (const stmt of body.namedChildren) {
    // Look for: __slots__ = ('x', 'y') or __slots__ = ['x', 'y']
    if (stmt.type !== 'expression_statement') continue
    const expr = stmt.namedChildren[0]
    if (!expr || expr.type !== 'assignment') continue

    const left = expr.childForFieldName('left')
    if (!left || left.text !== '__slots__') continue

    slotsFound = true
    const right = expr.childForFieldName('right')
    if (!right) continue

    // Collect string literals from tuple/list
    function collectSlots(n: SyntaxNode) {
      if (n.type === 'string') {
        const text = n.text.replace(/^[rubf]*['"]|['"]$/g, '')
        slots.add(text)
      }
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i)
        if (child) collectSlots(child)
      }
    }
    collectSlots(right)
  }

  return slotsFound ? slots : null
}

function getEnclosingClass(node: SyntaxNode): SyntaxNode | null {
  let current: SyntaxNode | null = node.parent
  while (current) {
    if (current.type === 'class_definition') return current
    current = current.parent
  }
  return null
}

export const pythonNonSlotAssignmentVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/non-slot-assignment',
  languages: ['python'],
  nodeTypes: ['assignment'],
  visit(node, filePath, sourceCode) {
    // Look for: self.attr = value
    const left = node.childForFieldName('left')
    if (!left || left.type !== 'attribute') return null

    const obj = left.childForFieldName('object')
    if (!obj || obj.text !== 'self') return null

    const attr = left.childForFieldName('attribute')
    if (!attr) return null
    const attrName = attr.text

    const classNode = getEnclosingClass(node)
    if (!classNode) return null

    const slots = getSlotsFromClass(classNode)
    if (!slots) return null // No __slots__ defined

    if (!slots.has(attrName)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Assignment to non-slot attribute',
        `\`${attrName}\` is not declared in \`__slots__\` — assigning to it will raise \`AttributeError\` at runtime.`,
        sourceCode,
        `Add \`'${attrName}'\` to the class's \`__slots__\` declaration.`,
      )
    }
    return null
  },
}
