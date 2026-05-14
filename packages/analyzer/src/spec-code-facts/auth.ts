import ts from 'typescript'
import { EXTRACTORS } from './metadata.js'
import type { SourceUnit } from './types.js'
import { expressionName, pushFact, rangeOf } from './utils.js'

export function isAuthName(name: string): boolean {
  return /(auth|authenticated|requireAuth|requireRole|role|permission|guard|jwt|session|admin|authorize|ensureUser)/i.test(name)
}

export function extractAuthFacts(unit: SourceUnit): void {
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const name = expressionName(node.expression)
      if (name && /^(requireAuth|requireRole|authorize|ensureAuth|requirePermission|canAccess)$/i.test(name)) {
        pushFact(
          unit.facts,
          unit.sourceFile,
          rangeOf(unit.ast, node),
          'auth.signal',
          'auth.detected',
          { signal: node.getText(unit.ast), source: name.toLowerCase().includes('role') ? 'role-check' : 'guard-call' },
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
          { signal: text, source: 'role-check' },
          EXTRACTORS.auth,
        )
      }
    }

    ts.forEachChild(node, visit)
  }

  visit(unit.ast)
}
