import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

// Patterns indicative of catastrophic backtracking: nested UNBOUNDED
// quantifiers like (a+)+, (a*)*, (a+){N,}. Bounded quantifiers
// `{0,2}`, `{1,5}`, etc. cap the iteration count and CAN'T blow up
// exponentially — exclude them. The previous regex `[{][0-9]` matched
// any `{<digit>` which mis-fired on bounded forms like `(;\d+){0,2}`.
const REDOS_PATTERN = /\([^)]*[+*]\)[+*]|\([^)]*[+*]\)\{\d+,\}/

export const pythonRedosVulnerableRegexVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/redos-vulnerable-regex-python',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    let objectName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      const obj = fn.childForFieldName('object')
      if (attr) methodName = attr.text
      if (obj) objectName = obj.text
    }

    if (objectName !== 're') return null
    if (!['compile', 'match', 'search', 'findall', 'fullmatch'].includes(methodName)) return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg || firstArg.type !== 'string') return null

    const pattern = firstArg.text.replace(/^[rRbBuU]*['"`]{1,3}|['"`]{1,3}$/g, '')
    if (REDOS_PATTERN.test(pattern)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'ReDoS-vulnerable regex pattern',
        `Regex pattern "${pattern}" contains nested quantifiers that may cause catastrophic backtracking.`,
        sourceCode,
        'Simplify the regex or use possessive quantifiers. Consider using the `regex` library with atomic groups.',
      )
    }

    return null
  },
}
