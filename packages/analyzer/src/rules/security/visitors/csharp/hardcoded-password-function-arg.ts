import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, getCreatedTypeName, isPlainStringLiteral, staticStringText } from './_helpers.js'

/**
 * Password literals passed to authentication calls: a `password:`/`pwd:`
 * named argument with a string literal, an auth-named method
 * (Authenticate/Login/SignIn/...) receiving a password-looking literal, or
 * `new NetworkCredential(user, "literal")`.
 */
const AUTH_METHOD_PATTERN = /^(?:login|signin|authenticate|validatecredentials|checkpassword|verifypassword|comparepassword|changepassword)(?:async)?$/i
const PASSWORD_ARG_NAMES = new Set(['password', 'pwd', 'passwd', 'pass'])
const PLAINTEXT_PASSWORD_PATTERN = /^[a-zA-Z0-9!@#$%^&*()_+\-=[\]{};':",.<>?/\\|`~]{8,}$/

function looksLikePassword(value: string): boolean {
  if (!PLAINTEXT_PASSWORD_PATTERN.test(value)) return false
  if (/^https?:\/\//.test(value) || /localhost/.test(value)) return false
  return true
}

function passwordLiteral(arg: SyntaxNode): string | null {
  if (!isPlainStringLiteral(arg)) return null
  const value = staticStringText(arg)
  return looksLikePassword(value) ? value : null
}

export const csharpHardcodedPasswordFunctionArgVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/hardcoded-password-function-arg',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'object_creation_expression'],
  visit(node, filePath, sourceCode) {
    const args = getCallArgs(node)

    // password: "literal" named argument on any call.
    const namedPassword = args.find(
      (a) => a.name !== null && PASSWORD_ARG_NAMES.has(a.name.toLowerCase()) && isPlainStringLiteral(a.value) && staticStringText(a.value).length > 0,
    )
    if (namedPassword) {
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Hardcoded password as function argument',
        `A string literal is passed as the "${namedPassword.name}" argument.`,
        sourceCode,
        'Load credentials from configuration or a secrets manager instead of source code.',
      )
    }

    if (node.type === 'object_creation_expression') {
      if (getCreatedTypeName(node) !== 'NetworkCredential') return null
      const secondArg = args[1]?.value
      if (!secondArg || !isPlainStringLiteral(secondArg) || staticStringText(secondArg).length === 0) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Hardcoded password as function argument',
        'new NetworkCredential() with a hardcoded password literal.',
        sourceCode,
        'Load credentials from configuration or a secrets manager instead of source code.',
      )
    }

    const methodName = getCSharpMethodName(node)
    if (!AUTH_METHOD_PATTERN.test(methodName)) return null
    const literalArg = args.find((a) => a.value && passwordLiteral(a.value) !== null)
    if (!literalArg) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Hardcoded password as function argument',
      `${methodName}() is called with a hardcoded string that looks like a password.`,
      sourceCode,
      'Load credentials from configuration or a secrets manager instead of source code.',
    )
  },
}
