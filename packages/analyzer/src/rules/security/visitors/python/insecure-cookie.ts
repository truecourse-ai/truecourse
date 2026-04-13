import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

export const pythonInsecureCookieVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-cookie',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    }

    if (methodName !== 'set_cookie') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    // Check for secure=<non-falsy> in keyword arguments.
    // Accept any value that is not explicitly False or None — this covers
    // secure=True, secure=some_var, secure=get_secure_flag(request), etc.
    let hasSecure = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'secure' && value) {
          const valText = value.text
          if (valText !== 'False' && valText !== 'None' && valText !== '0') {
            hasSecure = true
          }
        }
      }
    }

    if (!hasSecure) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Insecure cookie',
        'Cookie set without the secure flag. It may be transmitted over unencrypted HTTP.',
        sourceCode,
        'Add secure=True to the set_cookie() call.',
      )
    }

    return null
  },
}

export const pythonCookieWithoutHttpOnlyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/cookie-without-httponly',
  languages: ['python'],
  nodeTypes: ['call'],
  visit(node, filePath, sourceCode) {
    const fn = node.childForFieldName('function')
    if (!fn) return null

    let methodName = ''
    if (fn.type === 'attribute') {
      const attr = fn.childForFieldName('attribute')
      if (attr) methodName = attr.text
    }

    if (methodName !== 'set_cookie') return null

    const args = node.childForFieldName('arguments')
    if (!args) return null

    let hasHttpOnly = false
    for (const arg of args.namedChildren) {
      if (arg.type === 'keyword_argument') {
        const name = arg.childForFieldName('name')
        const value = arg.childForFieldName('value')
        if (name?.text === 'httponly' && value?.text === 'True') {
          hasHttpOnly = true
        }
      }
    }

    if (!hasHttpOnly) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Cookie without httpOnly',
        'Cookie set without the httponly flag. It can be accessed by client-side JavaScript.',
        sourceCode,
        'Add httponly=True to the set_cookie() call.',
      )
    }

    return null
  },
}
