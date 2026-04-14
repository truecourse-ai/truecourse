import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects accessing list[i] inside `for i, val in enumerate(list)` loops
 * when `val` is already available.
 */
export const pythonUnnecessaryListIndexLookupVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unnecessary-list-index-lookup',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    const left = node.childForFieldName('left')
    const right = node.childForFieldName('right')
    const body = node.childForFieldName('body')
    if (!left || !right || !body) return null

    // right must be enumerate(list)
    if (right.type !== 'call') return null
    const fn = right.childForFieldName('function')
    if (!fn || fn.type !== 'identifier' || fn.text !== 'enumerate') return null

    const enumArgs = right.childForFieldName('arguments')
    if (!enumArgs) return null
    const enumArgNodes = enumArgs.namedChildren
    if (enumArgNodes.length === 0) return null
    const listName = enumArgNodes[0].text

    // left must be (i, val) pattern
    if (left.type !== 'pattern_list' && left.type !== 'tuple_pattern') return null
    const loopVars = left.namedChildren
    if (loopVars.length !== 2) return null
    const idxVar = loopVars[0].text

    // Check body accesses list[i]
    const bodyText = body.text
    const pattern = new RegExp(`\\b${listName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\[\\s*${idxVar.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\]`)
    if (!pattern.test(bodyText)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Unnecessary list index lookup',
      `Inside \`for ${idxVar}, ... in enumerate(${listName})\`, \`${listName}[${idxVar}]\` is redundant — the value is already available as the loop variable.`,
      sourceCode,
      `Use the value loop variable directly instead of \`${listName}[${idxVar}]\`.`,
    )
  },
}
