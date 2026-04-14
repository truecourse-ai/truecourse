import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects accessing dict[key] inside a `for key, value in dict.items()` loop
 * when `value` is already available.
 */
export const pythonUnnecessaryDictIndexLookupVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-dict-index-lookup',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    // Pattern: for key, val in d.items():
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const body = node.childForFieldName('body')
    if (!left || !right || !body) return null

    // right must be a call to .items()
    if (right.type !== 'call') return null
    const fn = right.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null
    const attr = fn.childForFieldName('attribute')
    if (!attr || attr.text !== 'items') return null

    const dictObj = fn.childForFieldName('object')
    if (!dictObj) return null
    const dictName = dictObj.text

    // left must be a tuple: (key, val)
    if (left.type !== 'pattern_list' && left.type !== 'tuple_pattern') return null
    const loopVars = left.namedChildren
    if (loopVars.length !== 2) return null
    const keyVar = loopVars[0].text

    // Check if body accesses dict[key]
    const bodyText = body.text
    const pattern = new RegExp(`\\b${dictName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\[\\s*${keyVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]`)
    if (!pattern.test(bodyText)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary dict index lookup',
      `Inside \`for ${keyVar}, ... in ${dictName}.items()\`, \`${dictName}[${keyVar}]\` is redundant — the value is already available as the loop variable.`,
      sourceCode,
      `Use the value loop variable directly instead of \`${dictName}[${keyVar}]\`.`,
    )
  },
}
