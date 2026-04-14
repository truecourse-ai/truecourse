import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

export const templateCurlyInStringVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/template-curly-in-string',
  languages: JS_LANGUAGES,
  nodeTypes: ['string'],
  visit(node, filePath, sourceCode) {
    const text = node.text
    // Match ${...} inside single or double quoted strings
    if (/\$\{[^}]*\}/.test(text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Template expression in regular string',
        `String \`${text.slice(0, 60)}\` contains \`\${...}\` but is not a template literal — the interpolation will not be evaluated.`,
        sourceCode,
        'Change the string quotes to backticks: `` `...${expression}...` ``.',
      )
    }
    return null
  },
}
