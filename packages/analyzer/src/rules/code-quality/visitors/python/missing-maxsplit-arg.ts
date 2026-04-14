import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects str.split()[0] or str.split()[-1] without a maxsplit argument —
 * the entire string is split unnecessarily.
 */
export const pythonMissingMaxsplitArgVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/missing-maxsplit-arg',
  languages: ['python'],
  nodeTypes: ['subscript'],
  visit(node, filePath, sourceCode) {
    // Pattern: expr.split(...)[idx]  where idx is 0 or -1
    const value = node.childForFieldName('value')
    const subscript = node.childForFieldName('subscript')
    if (!value || !subscript) return null

    // Subscript must be 0 or -1
    const sliceText = subscript.text.trim()
    if (sliceText !== '0' && sliceText !== '-1') return null

    // Value must be a call to .split()
    if (value.type !== 'call') return null
    const fn = value.childForFieldName('function')
    if (!fn || fn.type !== 'attribute') return null
    const attr = fn.childForFieldName('attribute')
    if (!attr || attr.text !== 'split') return null

    // Check that maxsplit is not provided (either no 2nd arg or no keyword)
    const args = value.childForFieldName('arguments')
    const argNodes = args?.namedChildren ?? []
    const positionalArgs = argNodes.filter((c) => c.type !== 'keyword_argument')
    const kwArgs = argNodes
      .filter((c) => c.type === 'keyword_argument')
      .map((c) => c.childForFieldName('name')?.text)

    // maxsplit is 2nd positional arg or keyword
    if (positionalArgs.length >= 2) return null
    if (kwArgs.includes('maxsplit')) return null

    const obj = fn.childForFieldName('object')
    const objText = obj?.text ?? 'str'

    return makeViolation(
      this.ruleKey, node, filePath, 'low',
      'Missing maxsplit argument in split()',
      `\`${objText}.split()[${sliceText}]\` splits the entire string when only the ${sliceText === '0' ? 'first' : 'last'} part is needed. Add \`maxsplit=1\` to avoid unnecessary work.`,
      sourceCode,
      `Change to \`${objText}.split(maxsplit=1)[${sliceText}]\`.`,
    )
  },
}
