import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

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

    // Check if parent class is known to have __slots__ by looking if class body uses __slots__
    const bodyText = body.text
    const hasSlots = bodyText.includes('__slots__')

    if (hasSlots) return null

    // Check if any superclass has __slots__ (heuristic: look in the source for __slots__ in context)
    // Only flag if the class defines instance attributes
    const hasInstanceAttrs = bodyText.includes('self.')
    if (!hasInstanceAttrs) return null

    // Check if any parent in source defines __slots__
    const parentNames = superclasses.namedChildren.map((c) => c.text)
    // Simple heuristic: only flag if file itself defines a parent with __slots__
    for (const parentName of parentNames) {
      const parentPattern = new RegExp(`class\\s+${parentName}[^:]*:[\\s\\S]*?__slots__`)
      if (parentPattern.test(sourceCode)) {
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
