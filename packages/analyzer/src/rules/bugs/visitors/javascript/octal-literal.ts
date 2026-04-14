import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const octalLiteralVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/octal-literal',
  languages: JS_LANGUAGES,
  nodeTypes: ['number'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Legacy octal: starts with 0 followed by digits 0-7 (not 0x, 0o, 0b, 0n)
    if (/^0[0-7]+$/.test(text)) {
      const octalValue = parseInt(text, 8)
      return makeViolation(
        this.ruleKey, node, filePath, 'medium',
        'Legacy octal literal',
        `\`${text}\` is a legacy octal literal — use \`0o${text.slice(1)}\` instead.`,
        sourceCode,
        `Replace \`${text}\` with \`0o${text.slice(1)}\` to use modern ES6 octal syntax.`,
      )
    }
    return null
  },
}
