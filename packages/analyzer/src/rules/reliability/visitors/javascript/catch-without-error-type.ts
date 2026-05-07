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

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Catch without error type discrimination',
      'Catch block does not check or narrow the error type. Different error types may need different handling.',
      sourceCode,
      'Use instanceof checks or type guards in the catch block to handle specific error types.',
    )
  },
}
