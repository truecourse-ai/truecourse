import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const ungroupedShorthandPropertiesVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/ungrouped-shorthand-properties',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['object'],
  visit(node, filePath, sourceCode) {
    const properties = node.namedChildren.filter((c) => c.type === 'pair' || c.type === 'shorthand_property_identifier')

    // Only consider objects with 5+ properties
    if (properties.length < 5) return null

    let transitions = 0
    let prevIsShorthand: boolean | null = null

    for (const prop of properties) {
      const isShorthand = prop.type === 'shorthand_property_identifier'
        || (prop.type === 'pair' && (() => {
          const key = prop.childForFieldName('key')
          const value = prop.childForFieldName('value')
          return key?.type === 'property_identifier' && value?.type === 'identifier' && key.text === value.text
        })())

      if (prevIsShorthand !== null && isShorthand !== prevIsShorthand) {
        transitions++
      }
      prevIsShorthand = isShorthand
    }

    // Only flag when there are 4+ transitions — allows logical domain grouping
    if (transitions >= 4) {
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
