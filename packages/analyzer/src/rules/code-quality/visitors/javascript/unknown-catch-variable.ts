import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'

/**
 * Walk the catch body and check whether the catch variable
 * `name` is referenced anywhere. If never referenced, the body
 * has no type-safety risk regardless of the catch variable's
 * type — flagging it as untyped is noise.
 */
function isReferencedInBody(body: SyntaxNode, name: string): boolean {
  const queue: SyntaxNode[] = [body]
  while (queue.length > 0) {
    const n = queue.pop()!
    if (n.type === 'identifier' && n.text === name) return true
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) queue.push(c)
    }
  }
  return false
}

export const unknownCatchVariableVisitor: CodeRuleVisitor = {
  ruleKey: 'code-quality/deterministic/unknown-catch-variable',
  languages: ['typescript', 'tsx'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    const param = node.childForFieldName('parameter')
    if (!param) return null

    const typeAnnotation = node.childForFieldName('type')
    if (typeAnnotation) return null

    const paramName = param.text

    // Skip when the catch body never references the error variable.
    // `catch (err) { toast({ title: 'failed' }) }` — generic error
    // path with no property access on err. Since the body doesn't
    // touch the error, typing it makes no difference to type
    // safety. Most modern TS strict projects already get implicit
    // `unknown` for catch variables (TS 4.4+ with
    // `useUnknownInCatchVariables`); this skip removes the FP
    // noise on those projects regardless of compiler config.
    const body = node.childForFieldName('body')
    if (body && !isReferencedInBody(body, paramName)) return null

    return makeViolation(
      this.ruleKey, param, filePath, 'low',
      'Untyped catch variable',
      `Catch variable \`${paramName}\` should be typed as \`unknown\` for type safety: \`catch (${paramName}: unknown)\`.`,
      sourceCode,
      `Add ': unknown' type annotation: \`catch (${paramName}: unknown)\`.`,
    )
  },
}
