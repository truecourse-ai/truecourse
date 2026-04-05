import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detects: regex literals that start with = sign, like /=.../
// Looks like a /= division-assignment operator to readers
export const ambiguousDivRegexVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/ambiguous-div-regex',
  languages: JS_LANGUAGES,
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    // regex node text: /pattern/flags
    const text = node.text
    if (!text.startsWith('/')) return null

    // Skip empty regex
    if (text.length < 2) return null

    // Check if pattern starts with '='
    if (text[1] === '=') {
      return makeViolation(
        this.ruleKey, node, filePath, 'low',
        'Ambiguous division-like regex',
        `Regex \`${text}\` starts with \`=\` which looks like a \`/=\` division-assignment operator — use \`[=]\` or \`\\=\` to make the intent clear.`,
        sourceCode,
        `Replace \`/=\` at the start with \`/[=]\` or \`/\\=\` to avoid confusion with the /= operator.`,
      )
    }

    return null
  },
}
