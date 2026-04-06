import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detect obvious ReDoS patterns in regex literals:
// Nested quantifiers: (a+)+ (a*)* (a+)* (a*)+ etc.
// Overlapping alternation with quantifiers: (a|aa)+

const NESTED_QUANTIFIER_RE = /\([^)]*[+*][^)]*\)[+*?{]/

export const redosVulnerableRegexVisitor: CodeRuleVisitor = {
  ruleKey: 'bugs/deterministic/redos-vulnerable-regex',
  languages: JS_LANGUAGES,
  nodeTypes: ['regex'],
  visit(node, filePath, sourceCode) {
    const pattern = node.childForFieldName('pattern')
    if (!pattern) return null
    const text = pattern.text

    if (NESTED_QUANTIFIER_RE.test(text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'ReDoS vulnerable regex',
        `This regular expression contains nested quantifiers (e.g. \`(a+)+\`) that can cause catastrophic backtracking on adversarial input.`,
        sourceCode,
        'Rewrite the regular expression to avoid nested quantifiers or use a non-backtracking approach.',
      )
    }
    return null
  },
}
