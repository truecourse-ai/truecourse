import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// These are common mock attribute typos (should be followed by _with or have different name)
const MOCK_TYPOS: Record<string, string> = {
  'assert_called_once': 'assert_called_once_with',
  'assert_not_called_once': 'assert_not_called',
  'assert_called_with_once': 'assert_called_once_with',
  'assert_has_calls_once': 'assert_called_once_with',
  'assret_called': 'assert_called',
  'assret_called_once': 'assert_called_once',
  'assret_called_with': 'assert_called_with',
  'assret_called_once_with': 'assert_called_once_with',
  'assret_any_call': 'assert_any_call',
  'assret_has_calls': 'assert_has_calls',
  'assret_not_called': 'assert_not_called',
  'aseert_called': 'assert_called',
  'aseert_called_once': 'assert_called_once',
  'aseert_called_with': 'assert_called_with',
}

export const pythonInvalidMockAccessVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invalid-mock-access',
  languages: ['python'],
  nodeTypes: ['attribute'],
  visit(node, filePath, sourceCode) {
    const attr = node.childForFieldName('attribute')
    if (!attr) return null

    const attrName = attr.text
    const correction = MOCK_TYPOS[attrName]

    if (!correction) return null

    // Check if this looks like a mock access (called on something ending with mock/Mock)
    const obj = node.childForFieldName('object')
    if (!obj) return null

    const objText = obj.text.toLowerCase()
    if (
      !objText.includes('mock') &&
      !objText.includes('patch') &&
      !objText.includes('spy') &&
      !objText.includes('stub')
    ) return null

    return makeViolation(
      this.ruleKey, attr, filePath, 'high',
      'Invalid mock access — likely a typo',
      `\`${attrName}\` is not a valid mock method — did you mean \`${correction}\`? This will silently pass instead of asserting.`,
      sourceCode,
      `Replace \`${attrName}\` with \`${correction}\`.`,
    )
  },
}
