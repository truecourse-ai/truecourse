import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSliceToRemovePrefixSuffixVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/slice-to-remove-prefix-suffix',
  languages: ['python'],
  nodeTypes: ['subscript'],
  visit(node, filePath, sourceCode) {
    // Pattern: s[len(prefix):] or s[:-len(suffix)]
    const obj = node.childForFieldName('value')
    if (!obj) return null

    const sub = node.childForFieldName('subscript')
    if (!sub) return null

    // Check for slice
    if (sub.type !== 'slice') return null

    const sliceText = sub.text

    // Pattern: len(something):  → removeprefix
    if (/^len\(.+\):$/.test(sliceText.trim())) {
      const prefixMatch = sliceText.match(/^len\((.+)\):$/)
      if (prefixMatch) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Slice to remove prefix',
          `\`${obj.text}[len(${prefixMatch[1]}):]}\` — use \`${obj.text}.removeprefix(${prefixMatch[1]})\` (Python 3.9+).`,
          sourceCode,
          `Replace with \`${obj.text}.removeprefix(${prefixMatch[1]})\`.`,
        )
      }
    }

    // Pattern: :-len(something) → removesuffix
    if (/^:-len\(.+\)$/.test(sliceText.trim())) {
      const suffixMatch = sliceText.match(/^:-len\((.+)\)$/)
      if (suffixMatch) {
        return makeViolation(
          this.ruleKey, node, filePath, 'low',
          'Slice to remove suffix',
          `\`${obj.text}[:-len(${suffixMatch[1]})]}\` — use \`${obj.text}.removesuffix(${suffixMatch[1]})\` (Python 3.9+).`,
          sourceCode,
          `Replace with \`${obj.text}.removesuffix(${suffixMatch[1]})\`.`,
        )
      }
    }

    return null
  },
}
