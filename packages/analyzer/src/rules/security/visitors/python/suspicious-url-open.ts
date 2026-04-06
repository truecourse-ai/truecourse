import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonSuspiciousUrlOpenVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/suspicious-url-open',
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
    } else if (fn.type === 'identifier') {
      methodName = fn.text
    }

    if (methodName !== 'urlopen') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    const firstArg = args.namedChildren[0]
    if (!firstArg) return null

    // Flag when the URL is not a plain string literal (could be user-controlled)
    if (firstArg.type !== 'string' || firstArg.text.startsWith('f')) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'urlopen with user-controlled URL',
        `${objectName ? objectName + '.' : ''}urlopen() called with a non-literal URL. User-controlled URLs enable SSRF.`,
        sourceCode,
        'Validate and allowlist URLs before passing them to urlopen().',
      )
    }

    return null
  },
}
