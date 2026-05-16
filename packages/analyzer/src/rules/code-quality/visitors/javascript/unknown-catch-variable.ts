import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Collect every identifier reference of `name` inside `root` (excluding the parameter binding itself).
 */
function collectIdentifierReferences(root: SyntaxNode, name: string): SyntaxNode[] {
  const refs: SyntaxNode[] = []
  const visit = (n: SyntaxNode): void => {
    if (
      (n.type === 'identifier' || n.type === 'shorthand_property_identifier') &&
      n.text === name
    ) {
      refs.push(n)
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) visit(c)
    }
  }
  visit(root)
  return refs
}

/**
 * Does the catch body contain an `instanceof` check using `name`?
 *   if (err instanceof Error) { ... }
 *   err instanceof Foo ? ... : ...
 * tree-sitter shape: binary_expression(left=identifier 'err', operator='instanceof', right=...)
 */
function hasInstanceofCheck(body: SyntaxNode, name: string): boolean {
  let found = false
  const visit = (n: SyntaxNode): void => {
    if (found) return
    if (n.type === 'binary_expression') {
      const op = n.childForFieldName('operator')
      if (op && op.text === 'instanceof') {
        const left = n.childForFieldName('left')
        if (left && left.type === 'identifier' && left.text === name) {
          found = true
          return
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) visit(c)
    }
  }
  visit(body)
  return found
}

/**
 * Does the catch body pass the catch variable into a parse/normalize/wrap utility
 * call as the first arg? E.g.:
 *   AppError.parseError(err)
 *   parseError(err)
 *   normalizeError(err)
 *   ErrorParser.parse(err)
 *   serializeError(err)
 *   formatError(err)
 *   wrapError(err)
 *   fromError(err)
 *   toError(err)
 */
function hasNarrowingParseCall(body: SyntaxNode, name: string): boolean {
  const re = /^(parse|normalize|serialize|format|wrap|coerce|from|to|stringify|describe|extract|sanitize|handle|process|inspect|get)/i
  let found = false
  const visit = (n: SyntaxNode): void => {
    if (found) return
    if (n.type === 'call_expression') {
      const fn = n.childForFieldName('function')
      const args = n.childForFieldName('arguments')
      if (fn && args) {
        // first arg should be the catch var identifier
        const firstArg = args.namedChild(0)
        if (firstArg && firstArg.type === 'identifier' && firstArg.text === name) {
          // function: identifier 'parseError' OR member_expression with property matching 'error'/'err'-ish parser
          if (fn.type === 'identifier' && re.test(fn.text) && /error/i.test(fn.text)) {
            found = true
            return
          }
          if (fn.type === 'member_expression') {
            const prop = fn.childForFieldName('property')
            if (prop && re.test(prop.text) && /error/i.test(prop.text)) {
              found = true
              return
            }
          }
        }
      }
    }
    for (let i = 0; i < n.namedChildCount; i++) {
      const c = n.namedChild(i)
      if (c) visit(c)
    }
  }
  visit(body)
  return found
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

    // Skip simple cases where the parameter is structurally not a plain identifier
    // (e.g. destructuring patterns) — the rule targets the common `catch (err)` shape.
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(paramName)) return null

    // FP guard: underscore-prefixed names indicate intentional discard.
    if (paramName.startsWith('_')) return null

    const body = node.childForFieldName('body')
    if (body) {
      const refs = collectIdentifierReferences(body, paramName)

      // FP guard: catch variable never accessed inside the body.
      if (refs.length === 0) return null

      // FP guard: catch body uses `instanceof` to narrow the variable before access.
      if (hasInstanceofCheck(body, paramName)) return null

      // FP guard: catch body wraps the catch variable via a parse/normalize-error utility.
      if (hasNarrowingParseCall(body, paramName)) return null
    }

    return makeViolation(
      this.ruleKey, param, filePath, 'low',
      'Untyped catch variable',
      `Catch variable \`${paramName}\` should be typed as \`unknown\` for type safety: \`catch (${paramName}: unknown)\`.`,
      sourceCode,
      `Add ': unknown' type annotation: \`catch (${paramName}: unknown)\`.`,
    )
  },
}
