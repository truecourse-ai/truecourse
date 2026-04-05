import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonDictIterMissingItemsVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/dict-iter-missing-items',
  languages: ['python'],
  nodeTypes: ['for_statement'],
  visit(node, filePath, sourceCode) {
    // Detect: for key, value in some_dict:
    // where the loop variable is a tuple/pattern_list of exactly 2 identifiers
    // and the iterable does NOT end with .items() / .values() / .keys()
    const loopVar = node.childForFieldName('left')
    if (!loopVar) return null

    // Must be tuple unpacking with 2 vars
    if (loopVar.type !== 'pattern_list' && loopVar.type !== 'tuple_pattern') return null
    const vars = loopVar.namedChildren.filter((c) => c.type === 'identifier')
    if (vars.length !== 2) return null

    const iterExpr = node.childForFieldName('right')
    if (!iterExpr) return null

    // Skip if iterable is a call to .items(), .values(), .keys()
    if (iterExpr.type === 'call') {
      const fn = iterExpr.childForFieldName('function')
      if (fn?.type === 'attribute') {
        const attr = fn.childForFieldName('attribute')
        if (attr && ['items', 'values', 'keys'].includes(attr.text)) return null
      }
    }

    // Skip obvious non-dict types: enumerate, zip, etc.
    if (iterExpr.type === 'call') {
      const fn = iterExpr.childForFieldName('function')
      if (fn?.type === 'identifier' && ['enumerate', 'zip', 'reversed', 'sorted', 'map', 'filter', 'range'].includes(fn.text)) return null
    }

    // Heuristic: check if variable name suggests it's a dict (contains 'dict', 'map', ends in 's')
    // We use a simple naming heuristic to reduce false positives
    const iterName = iterExpr.type === 'identifier' ? iterExpr.text : ''
    const looksLikeDict = iterName.toLowerCase().includes('dict') ||
      iterName.toLowerCase().includes('map') ||
      iterName.toLowerCase().includes('config') ||
      iterName.toLowerCase().includes('params') ||
      iterName.toLowerCase().includes('kwargs') ||
      iterName.toLowerCase().includes('headers') ||
      iterName.toLowerCase().includes('data')

    if (!looksLikeDict && iterExpr.type !== 'dictionary') return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Dict iteration missing .items()',
      `\`for ${loopVar.text} in ${iterExpr.text}:\` iterates over dictionary keys, not (key, value) pairs. The second variable \`${vars[1].text}\` will receive characters of the key string if the key is a string.`,
      sourceCode,
      `Add \`.items()\`: \`for ${loopVar.text} in ${iterExpr.text}.items():\`.`,
    )
  },
}
