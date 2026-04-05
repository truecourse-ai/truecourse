import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Invisible/irregular whitespace characters that can cause subtle bugs
const INVISIBLE_WS_RE = /[\u000B\u000C\u00A0\u0085\u1680\u180E\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]/

export const invisibleWhitespaceVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/invisible-whitespace',
  languages: JS_LANGUAGES,
  nodeTypes: ['identifier', 'string', 'template_string', 'property_identifier'],
  visit(node, filePath, sourceCode) {
    if (INVISIBLE_WS_RE.test(node.text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Invisible whitespace character',
        `This code contains an invisible or irregular whitespace character that may cause unexpected behavior or parsing issues.`,
        sourceCode,
        'Remove or replace the invisible whitespace character with a regular space.',
      )
    }
    return null
  },
}
