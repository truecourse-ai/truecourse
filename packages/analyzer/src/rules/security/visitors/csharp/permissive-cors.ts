import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName, getCSharpReceiver } from '../../../_shared/csharp-helpers.js'
import { enclosingFunctionText, getCallArgs, isPlainStringLiteral, staticStringText } from './_helpers.js'

/**
 * Wildcard CORS: `AllowAnyOrigin()` combined with `AllowCredentials()` on the
 * same policy (an invalid + dangerous pairing the browser cannot enforce),
 * or `WithOrigins("*")`. AllowAnyOrigin alone (public read-only APIs) is a
 * deliberate choice and is not flagged.
 */
function outermostChain(node: SyntaxNode): SyntaxNode {
  let current = node
  while (current.parent && (current.parent.type === 'member_access_expression' || current.parent.type === 'invocation_expression')) {
    current = current.parent
  }
  return current
}

function rootReceiverIdentifier(invocation: SyntaxNode): string {
  let fn = invocation.childForFieldName('function')
  while (fn?.type === 'member_access_expression') {
    const expr = fn.childForFieldName('expression')
    if (!expr) break
    if (expr.type === 'identifier') return expr.text
    if (expr.type === 'invocation_expression') {
      fn = expr.childForFieldName('function')
      continue
    }
    fn = expr
  }
  return ''
}

export const csharpPermissiveCorsVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/permissive-cors',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression'],
  visit(node, filePath, sourceCode) {
    const methodName = getCSharpMethodName(node)

    if (methodName === 'WithOrigins') {
      const args = getCallArgs(node)
      const wildcard = args.find((a) => isPlainStringLiteral(a.value) && staticStringText(a.value) === '*')
      if (!wildcard) return null
      return makeViolation(
        this.ruleKey, node, filePath, 'high',
        'Permissive CORS configuration',
        'WithOrigins("*") allows any domain to make cross-origin requests.',
        sourceCode,
        'List the specific trusted origins instead of "*".',
      )
    }

    if (methodName !== 'AllowAnyOrigin') return null

    // Chained on the same fluent expression: builder.AllowAnyOrigin().AllowCredentials()
    const chain = outermostChain(node)
    let pairedWithCredentials = /\bAllowCredentials\s*\(/.test(chain.text)

    // Separate statements on the same policy builder variable.
    if (!pairedWithCredentials) {
      const receiver = rootReceiverIdentifier(node)
      if (receiver) {
        const bodyText = enclosingFunctionText(node)
        const pattern = new RegExp(`\\b${receiver.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\.\\s*AllowCredentials\\s*\\(`)
        pairedWithCredentials = pattern.test(bodyText)
      }
    }

    if (!pairedWithCredentials) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'high',
      'Permissive CORS configuration',
      'AllowAnyOrigin() combined with AllowCredentials() lets any site send authenticated cross-origin requests.',
      sourceCode,
      'Replace AllowAnyOrigin() with WithOrigins(...) listing trusted domains when credentials are allowed.',
    )
  },
}
