import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { enclosingFunctionText, findRequestTaint, getCallArgs } from './_helpers.js'

/**
 * Open redirect: `Redirect()` with a URL taken from a route-handler
 * parameter or direct Request access, with no `Url.IsLocalUrl` validation in
 * the same method. The safe idioms — `LocalRedirect()`, fixed paths,
 * IsLocalUrl-guarded redirects — never match.
 */
const REDIRECT_METHODS = new Set(['Redirect', 'RedirectPermanent', 'RedirectPreserveMethod', 'RedirectPermanentPreserveMethod'])

export const csharpUserInputInRedirectVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/user-input-in-redirect',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    if (!REDIRECT_METHODS.has(getCSharpMethodName(node))) return null
    const arg = getCallArgs(node)[0]?.value
    if (!arg) return null

    const taint = findRequestTaint(arg)
    if (!taint) return null

    if (/\bIsLocalUrl\s*\(/.test(enclosingFunctionText(node))) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'User input in redirect URL',
      `Redirect target comes from user-controlled input ("${taint.text}"). This enables open-redirect phishing.`,
      sourceCode,
      'Use LocalRedirect(), or validate with Url.IsLocalUrl()/an allowlist before redirecting.',
    )
  },
}
