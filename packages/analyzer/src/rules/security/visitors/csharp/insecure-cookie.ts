import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { assignmentTarget, lastSegment } from './_helpers.js'

/**
 * Cookies explicitly configured insecurely. Only explicit `Secure = false` /
 * `HttpOnly = false` (or `SecurePolicy = CookieSecurePolicy.None`) on cookie
 * option types fire — absence is commonly handled by app-wide
 * CookiePolicy middleware, so flagging omissions would FP.
 */
const COOKIE_OPTION_TYPES = new Set(['CookieOptions', 'CookieBuilder'])

function isCookieOptionsContext(assign: SyntaxNode, receiver: string): boolean {
  // Object-initializer entry: new CookieOptions { Secure = false }
  let current = assign.parent
  while (current) {
    if (current.type === 'object_creation_expression') {
      const type = current.childForFieldName('type') ?? current.namedChildren[0]
      const simple = type ? lastSegment(type.text) : ''
      if (COOKIE_OPTION_TYPES.has(simple)) return true
      return false
    }
    if (current.type !== 'initializer_expression' && current.type !== 'assignment_expression') break
    current = current.parent
  }
  // Statement form: cookieOptions.Secure = false / options.Cookie.HttpOnly = false
  return /cookie/i.test(receiver)
}

function flagValue(node: SyntaxNode): boolean {
  return node.type === 'boolean_literal' && node.text === 'false'
}

export const csharpInsecureCookieVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/insecure-cookie',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const target = assignmentTarget(node)
    if (!target) return null

    if (target.name === 'Secure' && flagValue(target.value) && isCookieOptionsContext(node, target.receiver)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Insecure cookie',
        'Cookie configured with Secure = false. It will be transmitted over unencrypted HTTP.',
        sourceCode,
        'Set Secure = true (or CookieSecurePolicy.Always) so the cookie is HTTPS-only.',
      )
    }

    if (target.name === 'SecurePolicy' && lastSegment(target.value.text) === 'None' && /CookieSecurePolicy/.test(target.value.text)) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Insecure cookie',
        'CookieSecurePolicy.None allows cookies over unencrypted HTTP.',
        sourceCode,
        'Use CookieSecurePolicy.Always in production.',
      )
    }

    return null
  },
}

export const csharpCookieWithoutHttpOnlyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/cookie-without-httponly',
  languages: ['csharp'],
  nodeTypes: ['assignment_expression'],
  visit(node, filePath, sourceCode) {
    const target = assignmentTarget(node)
    if (!target || target.name !== 'HttpOnly' || !flagValue(target.value)) return null
    if (!isCookieOptionsContext(node, target.receiver)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Cookie without httpOnly',
      'Cookie configured with HttpOnly = false. Client-side JavaScript can read it (XSS token theft).',
      sourceCode,
      'Set HttpOnly = true unless script access is strictly required.',
    )
  },
}
