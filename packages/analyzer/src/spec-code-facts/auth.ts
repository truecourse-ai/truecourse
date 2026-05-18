import ts from 'typescript'
import { EXTRACTORS } from './metadata.js'
import type { SourceUnit } from './types.js'
import { expressionName, pushFact, rangeOf } from './utils.js'

export function isAuthName(name: string): boolean {
  return /(auth|authenticated|requireAuth|requireRole|role|permission|guard|jwt|session|admin|authorize|ensureUser|protect|clerk|middleware)/i.test(name)
}

export function extractAuthFacts(unit: SourceUnit): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = expressionName(node.expression)
      if (name && /^(requireAuth|requireRole|authorize|ensureAuth|requirePermission|canAccess|protect|clerkMiddleware)$/i.test(name)) {
        const args = node.arguments.map((arg) => arg.getText(unit.ast))
        const signal = node.getText(unit.ast)
        pushFact(
          unit.facts,
          unit.sourceFile,
          rangeOf(unit.ast, node),
          'auth.signal',
          'auth.detected',
          {
            signal,
            source: name.toLowerCase().includes('role')
              ? 'role-check'
              : name.toLowerCase().includes('clerk')
                ? 'middleware'
              : name.toLowerCase().includes('permission')
                ? 'permission-check'
                : name.toLowerCase().includes('access')
                  ? 'ownership-check'
                  : 'guard-call',
            roles: args.filter((arg) => /admin|owner|user|member|manager|editor|viewer/i.test(arg)).map((arg) => arg.replace(/^['"]|['"]$/g, '')),
            permissions: args.filter((arg) => /[.:_-]/.test(arg)).map((arg) => arg.replace(/^['"]|['"]$/g, '')),
            adminOnly: /admin/i.test(signal),
            ownershipCheck: /owner|userId|canAccess|belongsTo|self/i.test(signal),
          },
          EXTRACTORS.auth,
        )
      }
    }

    if (ts.isBinaryExpression(node)) {
      const text = node.getText(unit.ast)
      if (/\b(role|permissions?)\b/i.test(text) && /(===|!==|==|!=|includes)/.test(text)) {
        pushFact(
          unit.facts,
          unit.sourceFile,
          rangeOf(unit.ast, node),
          'auth.signal',
          'auth.detected',
          {
            signal: text,
            source: /\bpermissions?\b/i.test(text) ? 'permission-check' : 'role-check',
            adminOnly: /\badmin\b/i.test(text),
            ownershipCheck: /\b(owner|userId|createdBy|accountId)\b/i.test(text),
            publicRoute: /\b(public|anonymous|unauthenticated)\b/i.test(text),
          },
          EXTRACTORS.auth,
        )
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(unit.ast)
}
