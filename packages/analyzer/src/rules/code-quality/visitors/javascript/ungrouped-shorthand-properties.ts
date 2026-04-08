import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const ungroupedShorthandPropertiesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/ungrouped-shorthand-properties',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['object'],
  visit(node, filePath, sourceCode) {
    const properties = node.namedChildren.filter((c) => c.type === 'pair' || c.type === 'shorthand_property_identifier')

    if (properties.length < 6) return null

    let shorthandSection = false
    let regularSection = false
    let ungrouped = false

    for (const prop of properties) {
      const isShorthand = prop.type === 'shorthand_property_identifier'
        || (prop.type === 'pair' && (() => {
          const key = prop.childForFieldName('key')
          const value = prop.childForFieldName('value')
          return key?.type === 'property_identifier' && value?.type === 'identifier' && key.text === value.text
        })())

      if (isShorthand) {
        if (regularSection) ungrouped = true
        shorthandSection = true
      } else {
        if (shorthandSection) regularSection = true
      }
    }

    if (ungrouped) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Ungrouped shorthand properties',
        'Shorthand property declarations are interleaved with regular properties. Group shorthand properties together.',
        sourceCode,
        'Move all shorthand properties to the beginning or end of the object literal.',
      )
    }
    return null
  },
}
