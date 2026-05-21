import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { JS_LANGUAGES } from './_helpers.js'

// Detect canonical ReDoS shapes: a group containing a SINGLE quantified atom
// (`a+`, `\d+`, `[a-z]+`, `.+`, …) that is itself repeated with an unbounded
// outer quantifier (`+`/`*`). Patterns with `?` outer quantifier (e.g.
// `(P)?`) repeat at most once and are not vulnerable. Patterns with an
// anchor character/class before the inner quantifier (e.g. `([-_][a-z]+)*`)
// have bounded backtracking because adjacent iterations are separated by a
// distinct atom.
const NESTED_QUANTIFIER_RE = /\((?:\?:)?(?:\\[a-zA-Z]|\\[^a-zA-Z]|\.|\[[^\]]*\]|[a-zA-Z0-9_])[+*]\??\)[+*]\??/

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
