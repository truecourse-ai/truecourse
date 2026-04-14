import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Detects octal escape sequences in regex strings like \1 through \9 (backreferences)
 * or \012 (octal) which are confusing and error-prone.
 */
export const pythonRegexOctalEscapeVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/regex-octal-escape',
  languages: ['python'],
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const parent = node.parent
    if (!parent || parent.type !== 'argument_list') return null

    const grandParent = parent.parent
    if (!grandParent || grandParent.type !== 'call') return null

    const fn = grandParent.childForFieldName('function')
    if (!fn) return null

    const fnText = fn.text
    const isReCall = fnText.startsWith('re.') || fnText === 'compile'
    if (!isReCall) return null

    const rawText = node.text
    // Look for octal escape sequences: \0XX or \[1-7][0-7] (not r-strings which handle them differently)
    // Check non-raw strings for octal escapes
    if (rawText.startsWith('r"') || rawText.startsWith("r'") || rawText.startsWith('r"""') || rawText.startsWith("r'''")) {
      return null // raw strings — octal not an issue
    }

    if (/\\[0-7]{2,3}/.test(rawText) || /\\[1-9](?!\d)/.test(rawText)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Octal escape sequence in regex',
        'Regex contains an octal escape sequence — use explicit hex (`\\xNN`) or Unicode (`\\uNNNN`) escapes instead.',
        sourceCode,
        'Replace octal escapes with explicit hex or Unicode escapes, or use a raw string with the pattern.',
      )
    }

    return null
  },
}
