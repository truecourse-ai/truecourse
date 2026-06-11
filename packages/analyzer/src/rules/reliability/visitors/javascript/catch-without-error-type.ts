import type { CodeRuleVisitor } from '../../../types.js'
import type { Node as SyntaxNode } from 'web-tree-sitter'
import { makeViolation } from '../../../types.js'

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

    const hasTypeAnnotation = node.childForFieldName('type') !== null
    if (hasTypeAnnotation) return null

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

    // Skip uniform handlers: multi-statement bodies that contain no `if`
    // / `switch` / ternary branching. UI error handlers in particular
    // (`console.error(err); toast(...); throw err;`) handle every error
    // the same way — log, surface a generic user message, optionally
    // rethrow. No type discrimination would change behaviour, so flagging
    // them is noise.
    if (!hasBranchingConstruct(body)) return null

    // Skip when the body narrows the error through a user-defined type guard,
    // e.g. `if (!isExecaChildProcess(error)) throw error`. `instanceof`/`typeof`
    // are not the only ways to discriminate an error — predicate functions
    // (`isXxx` / `hasXxx` / `assertXxx`) applied to the caught binding are the
    // idiomatic TS type-guard pattern and narrow it just as effectively.
    const paramName = param.type === 'identifier' ? param.text : null
    if (paramName && narrowsViaTypeGuard(body, paramName)) return null

    return makeViolation(
      this.ruleKey, node, filePath, 'medium',
      'Catch without error type discrimination',
      'Catch block does not check or narrow the error type. Different error types may need different handling.',
      sourceCode,
      'Use instanceof checks or type guards in the catch block to handle specific error types.',
    )
  },
}

// True when `body` contains a type-guard-style call (`isXxx`/`hasXxx`/`assertXxx`)
// that receives the caught error binding as an argument — the user-defined
// equivalent of an `instanceof` narrowing.
const TYPE_GUARD_NAME = /^(is|has|assert)[A-Z]/
function narrowsViaTypeGuard(node: SyntaxNode, paramName: string): boolean {
  if (node.type === 'call_expression') {
    const fn = node.childForFieldName('function')
    let calleeName: string | null = null
    if (fn?.type === 'identifier') calleeName = fn.text
    else if (fn?.type === 'member_expression') calleeName = fn.childForFieldName('property')?.text ?? null
    if (calleeName && TYPE_GUARD_NAME.test(calleeName)) {
      const args = node.childForFieldName('arguments')
      if (args && referencesBinding(args, paramName)) return true
    }
  }
  for (let i = 0; i < node.childCount; i++) {
    const ch = node.child(i)
    if (ch && narrowsViaTypeGuard(ch, paramName)) return true
  }
  return false
}

// True when `node` contains an identifier matching `name` (the bare binding or
// the object root of a member access like `name.cause`).
function referencesBinding(node: SyntaxNode, name: string): boolean {
  if (node.type === 'identifier' && node.text === name) return true
  for (let i = 0; i < node.childCount; i++) {
    const ch = node.child(i)
    if (ch && referencesBinding(ch, name)) return true
  }
  return false
}

function hasBranchingConstruct(node: SyntaxNode): boolean {
  if (
    node.type === 'if_statement' ||
    node.type === 'switch_statement' ||
    node.type === 'ternary_expression'
  ) return true
  if (
    node.type === 'function_declaration' ||
    node.type === 'function_expression' ||
    node.type === 'arrow_function' ||
    node.type === 'method_definition'
  ) return false
  for (let i = 0; i < node.childCount; i++) {
    const ch = node.child(i)
    if (ch && hasBranchingConstruct(ch)) return true
  }
  return false
}
