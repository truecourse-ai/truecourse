import type { Node as SyntaxNode } from 'web-tree-sitter'
import type { CodeRuleVisitor } from '../../../types.js'
import { makeViolation } from '../../../types.js'

/**
 * Walk subtree looking for a variable declaration whose initializer
 * is a call_expression with `paramName` passed as one of the argument
 * identifiers. This is the canonical project-specific narrowing
 * pattern: `const error = AppError.parseError(err)`,
 * `const e = normalizeError(err)`, etc. — the call inspects the
 * untyped error and returns a discriminated wrapper.
 */
function hasNarrowingAssignment(root: SyntaxNode, paramName: string): boolean {
  if (root.type === 'lexical_declaration' || root.type === 'variable_declaration') {
    for (const decl of root.namedChildren) {
      if (decl.type !== 'variable_declarator') continue
      const value = decl.childForFieldName('value')
      if (!value || value.type !== 'call_expression') continue
      const args = value.childForFieldName('arguments')
      if (!args) continue
      for (const arg of args.namedChildren) {
        if (arg.type === 'identifier' && arg.text === paramName) return true
      }
    }
  }
  for (const child of root.namedChildren) {
    if (hasNarrowingAssignment(child, paramName)) return true
  }
  return false
}

export const catchWithoutErrorTypeVisitor: CodeRuleVisitor = {
  ruleKey: 'reliability/deterministic/catch-without-error-type',
  languages: ['typescript', 'tsx', 'javascript'],
  nodeTypes: ['catch_clause'],
  visit(node, filePath, sourceCode) {
    // Get the catch parameter
    const param = node.childForFieldName('parameter')
    if (!param) {
      // catch without parameter at all — also a problem but less common
      return null
    }

    // If the catch body checks instanceof or typeof, it's fine
    const body = node.childForFieldName('body')
    if (!body) return null
    const bodyText = body.text
    if (bodyText.includes('instanceof') || bodyText.includes('typeof')) return null

    // Library type-guard narrowing. Axios, ts-rest, react-query, and
    // most HTTP / RPC libraries ship type-guard helpers like
    // `axios.isAxiosError(e)`, `isAppError(e)`, `isHttpError(e)`,
    // `Error.isError(e)`, etc. The textual `instanceof`/`typeof`
    // check above can't see these as narrowing, so handlers that
    // discriminate via a library type-guard fire as if untyped.
    if (/\bis[A-Z]\w*Error\b/.test(bodyText)) return null
    if (/\baxios\.isAxiosError\b/.test(bodyText)) return null
    // String-conversion handlers: `String(e)`, `e?.message`, `e instanceof
    // Error ? e.message : String(e)` (already covered by instanceof above).
    // `String(e)` alone suffices for log paths and shouldn't fire.
    const paramNameForString = param.type === 'identifier' ? param.text : ''
    if (paramNameForString) {
      const stringConvertRe = new RegExp(`\\bString\\s*\\(\\s*${paramNameForString}\\s*\\)`)
      if (stringConvertRe.test(bodyText)) return null
    }

    // Type annotation skip — but only for specific types that ARE
    // narrowing on their own (`: Error`, `: SomeError`). The TS 4.0+
    // idiom `catch (err: unknown)` is not narrowing — it just spells
    // out what TypeScript would infer anyway, and the body still
    // needs to discriminate. Treating `: unknown` as a skip path
    // misses real findings AND also broke the only fixture path for
    // demonstrating the documenso-style narrowing-helper pattern.
    const annot = node.childForFieldName('type')
    if (annot) {
      const annotText = annot.text.replace(/^:\s*/, '').trim()
      if (annotText !== 'unknown' && annotText !== 'any') return null
    }

    // Short handlers - one statement that logs, returns a default, or
    // re-throws - aren't doing branching work that benefits from type
    // discrimination. Flagging them is noise: `safeParse` / `safeRun`
    // wrappers, the most common JS try/catch pattern in app code, would
    // all fire even though they're correctly written. Restrict the rule
    // to bodies with multiple statements where discrimination would
    // actually change behaviour.
    const stmts = body.namedChildren.filter(
      (c) => c.type !== 'comment',
    )
    if (stmts.length <= 1) return null

    // Project-specific narrowing helpers. When the body's first action
    // (or any subsequent action) binds the catch parameter to a new
    // local via a function call — `const error = AppError.parseError(err)`,
    // `const e = normalizeError(err)`, `const ae = toAppError(err)` —
    // narrowing is happening inside that call. The `instanceof`/`typeof`
    // textual heuristic above can't see across the call boundary, but
    // the param-passed-to-call shape is reliable signal.
    const paramName = param.type === 'identifier' ? param.text : null
    if (paramName && hasNarrowingAssignment(body, paramName)) return null

    // Universal "log + return default" fallback shape. The body is a
    // few statements where the non-final ones are all `console.*` /
    // logger calls and the final statement is a `return` of a
    // literal / sentinel value. This is a no-branching error path —
    // type narrowing wouldn't change behaviour because the handler
    // ignores the error type. Common in array map/filter callbacks
    // where a parse failure should fall through to a default.
    {
      const nonFinal = stmts.slice(0, -1)
      const final = stmts[stmts.length - 1]
      const isLogCall = (n: SyntaxNode): boolean => {
        if (n.type !== 'expression_statement') return false
        const inner = n.namedChildren[0]
        if (inner?.type !== 'call_expression') return false
        const fn = inner.childForFieldName('function')
        if (fn?.type !== 'member_expression') return false
        const obj = fn.childForFieldName('object')?.text ?? ''
        return obj === 'console' || /^(?:logger|log|tracer|metrics)$/i.test(obj)
      }
      const allLog = nonFinal.length > 0 && nonFinal.every(isLogCall)
      const isLiteralReturn = (n: SyntaxNode): boolean => {
        if (n.type !== 'return_statement') return false
        const v = n.namedChildren[0]
        if (!v) return true // bare return
        return (
          v.type === 'number' ||
          v.type === 'string' ||
          v.type === 'true' ||
          v.type === 'false' ||
          v.type === 'null' ||
          v.type === 'undefined' ||
          v.type === 'array' ||
          v.type === 'object' ||
          v.type === 'identifier' && (v.text === 'null' || v.text === 'undefined' || v.text === 'false' || v.text === 'true')
        )
      }
      if (allLog && isLiteralReturn(final)) return null
    }

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Catch without error type discrimination',
      'Catch block does not check or narrow the error type. Different error types may need different handling.',
      sourceCode,
      'Use instanceof checks or type guards in the catch block to handle specific error types.',
    )
  },
}
