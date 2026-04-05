import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const misleadingArrayReverseVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/misleading-array-reverse',
  languages: JS_LANGUAGES,
  nodeTypes: ['call_expression'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn || fn.type !== 'member_expression') return null

    const prop = fn.childForFieldName('property')
    if (!prop || (prop.text !== 'reverse' && prop.text !== 'sort')) return null

    const obj = fn.childForFieldName('object')
    if (!obj) return null

    // Only flag if: the result of calling reverse/sort is assigned to a variable
    // and the receiver is a simple identifier (so the original is also mutated)
    const parent = node.parent
    if (!parent) return null

    // Flag when: const x = arr.reverse() or let x = arr.sort(...)
    // i.e., parent is variable_declarator or assignment_expression right-hand side
    if (
      (parent.type === 'variable_declarator' && parent.childForFieldName('value') === node) ||
      (parent.type === 'assignment_expression' && parent.childForFieldName('right') === node)
    ) {
      if (obj.type === 'identifier') {
        return makeViolation(
          this.ruleKey, node, filePath, 'medium',
          'Misleading array mutation',
          `\`${obj.text}.${prop.text}()\` mutates \`${obj.text}\` in place AND returns it. Assigning the result looks non-mutating but the original \`${obj.text}\` is also changed.`,
          sourceCode,
          `Use \`[...${obj.text}].${prop.text}()\` or \`${obj.text}.${prop.text === 'sort' ? 'toSorted' : 'toReversed'}()\` (ES2023) to avoid mutating the original.`,
        )
      }
    }

    return null
  },
}
