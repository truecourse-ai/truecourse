import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import { getCSharpMethodName } from '../../../_shared/csharp-helpers.js'
import { getCallArgs, isPlainStringLiteral, staticStringText } from './_helpers.js'

/**
 * A Content-Security-Policy response header set to a permissive value:
 *   - `Headers.Add("Content-Security-Policy", "<value>")` / `.Append(...)`
 *   - `Headers["Content-Security-Policy"] = "<value>"`
 * where the literal value contains `unsafe-inline`, `unsafe-eval`, or a
 * wildcard `*` source. Those directives re-open the XSS holes CSP exists to
 * close.
 */
const CSP_HEADER = /^content-security-policy(?:-report-only)?$/i
const PERMISSIVE = /\bunsafe-inline\b|\bunsafe-eval\b|(?:^|[\s;:])\*(?:[\s;]|$)/i

function isCspName(node: SyntaxNode | undefined): boolean {
  return !!node && isPlainStringLiteral(node) && CSP_HEADER.test(staticStringText(node).trim())
}

function isPermissive(node: SyntaxNode | undefined): boolean {
  return !!node && isPlainStringLiteral(node) && PERMISSIVE.test(staticStringText(node))
}

export const csharpPermissiveContentSecurityPolicyVisitor: CodeRuleVisitor = {
  ruleKey: 'security/deterministic/permissive-content-security-policy',
  languages: ['csharp'],
  nodeTypes: ['invocation_expression', 'assignment_expression'],
  visit(node, filePath, sourceCode) {
    if (node.type === 'invocation_expression') {
      const method = getCSharpMethodName(node)
      if (method !== 'Add' && method !== 'Append') return null
      const args = getCallArgs(node)
      if (!isCspName(args[0]?.value)) return null
      if (!args.slice(1).some((a) => isPermissive(a.value))) return null
    } else {
      // Headers["Content-Security-Policy"] = "<value>"
      const left = node.childForFieldName('left') ?? node.namedChildren[0]
      const right = node.childForFieldName('right') ?? node.namedChildren[node.namedChildren.length - 1]
      if (left?.type !== 'element_access_expression') return null
      const subscript = left.namedChildren.find((c) => c?.type === 'bracketed_argument_list')
      const keyArg = subscript?.namedChildren.find((c) => c?.type === 'argument')?.namedChildren[0]
      if (!isCspName(keyArg ?? undefined)) return null
      if (!isPermissive(right ?? undefined)) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Permissive Content Security Policy',
      'This Content-Security-Policy allows unsafe-inline/unsafe-eval or a wildcard source, re-opening the XSS holes the policy is meant to close.',
      sourceCode,
      'Tighten the policy: drop unsafe-inline/unsafe-eval and wildcards, and allowlist specific trusted origins (use nonces/hashes for inline scripts).',
    )
  },
}
